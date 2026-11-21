import type { Context } from "@earendil-works/chord/context";
import type {
  JsonObject,
  ToolExecutionApi,
  ToolExecutionResult,
  ToolPark,
} from "@earendil-works/pi-durable";
import { z } from "zod";
import {
  ApprovalNotPendingError,
  approvalWaitInfo,
  declinedResult,
  waitForApproval,
  type ApprovalDecision,
  type GateHooks,
  type GatePlan,
} from "./approvals";
import { durableMemo, toJson } from "./durable-json";
import {
  mayAutoReview,
  mustAsk,
  ownerTurn,
  tokenBudget,
  yoloOf,
  type GateUserMessage,
} from "./policy";
import { secretRedactor } from "./redact";
import { ownerMessages, type Reviewer, type ReviewVerdict } from "./reviewer";
import { refuseUnattended, unattendedOnce, type WaitInfo, type WaitTracker } from "./waiting";

export interface GateCall {
  readonly name: string;
  readonly args: unknown;
  readonly replaySafe: boolean;
  readonly hooks: GateHooks<unknown> | undefined;
  readonly api: ToolExecutionApi;
  readonly context: Context;
  readonly answers: "document" | "memory";
  userMessages(): Promise<readonly GateUserMessage[]>;
  run?(): Promise<string | undefined>;
  instructions(): Promise<string | undefined>;
}

export interface GateStore {
  decide(
    conversation: number,
    taskId: number,
    decision: ApprovalDecision,
    options: { grant?: boolean },
  ): Promise<void>;
  approveForYolo(conversation: number, taskId: number): Promise<void>;
  grant(conversation: number, grant: string): Promise<void>;
}

export interface ToolGateOptions {
  approvals: WaitTracker;
  stop?: (conversation: number) => void;
  reviewer?: Reviewer;
  ownerUserId?: () => Promise<number | undefined>;
  store?: GateStore;
}

interface HeldAnswer {
  vault: boolean;
  grant?: string;
  settle(decision: ApprovalDecision | "expired"): void;
  abandon(): void;
}

const text = (value: string) => [{ type: "text" as const, text: value }];

const noStore: GateStore = {
  decide: async (_conversation, taskId) => {
    throw new ApprovalNotPendingError(taskId);
  },
  approveForYolo: async (_conversation, taskId) => {
    throw new ApprovalNotPendingError(taskId);
  },
  grant: async () => undefined,
};

const heldKey = (conversation: number, taskId: number) => `${conversation}:${taskId}`;

const BUDGET_STOP_FACTOR = 1.5;

export const RUN_TOOL_CALL_LIMIT = 150;
const RUN_STOP_AFTER = 20;
const RUN_COUNTS_KEPT = 500;

function runCapRefusal(name: string): string {
  return (
    `${name} did not run: this reply has already made ${RUN_TOOL_CALL_LIMIT} tool calls, ` +
    `the most one reply may make. Do not call any more tools. ` +
    `Reply now with what you have, say what was left undone, and let the owner decide how to go on.`
  );
}

function budgetRefusal(name: string, used: number, budget: number): string {
  return (
    `${name} did not run: this run has used ${used.toLocaleString("en-US")} tokens, ` +
    `over its budget of ${budget.toLocaleString("en-US")}. Do not call any more tools. ` +
    `Reply now with what you found so far, and say what was left undone.`
  );
}

export class ToolGate {
  readonly #approvals: WaitTracker;
  readonly #reviewer: Reviewer | undefined;
  readonly #ownerUserId: () => Promise<number | undefined>;
  readonly #store: GateStore;
  readonly #stop: ((conversation: number) => void) | undefined;
  readonly #held = new Map<string, HeldAnswer>();
  readonly #runCalls = new Map<string, number>();

  constructor(options: ToolGateOptions) {
    this.#approvals = options.approvals;
    this.#stop = options.stop;
    this.#reviewer = options.reviewer;
    this.#ownerUserId = options.ownerUserId ?? (async () => undefined);
    this.#store = options.store ?? noStore;
  }

  waiting(conversation: number): number {
    return this.#approvals.count(conversation);
  }

  async run(
    call: GateCall,
    execute: () => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> {
    const { name, args, api, context, hooks } = call;
    const overBudget = await this.#overBudget(call);
    if (overBudget) {
      return {
        output: text(budgetRefusal(name, overBudget.used, overBudget.budget)),
        isError: true,
        details: { budget: { used: overBudget.used, limit: overBudget.budget } },
      };
    }
    if (await this.#overRunCap(call)) {
      return {
        output: text(runCapRefusal(name)),
        isError: true,
        details: { runCap: { limit: RUN_TOOL_CALL_LIMIT } },
      };
    }
    const plan = hooks ? await planOnce(call, hooks) : undefined;
    if (plan?.refuse) {
      return { output: text(plan.refuse), isError: true, details: { refused: true } };
    }
    const ask = await api.memo(
      "gate:ask",
      plan ? plan.ask : await mustAsk(name, api, context),
      context,
    );
    if (ask && (await unattendedOnce(api, context))) {
      return refuseUnattended(
        `${name} needs the owner's approval, and nobody is here to give it: this is a scheduled routine run. It did not run. Finish without it and say what it was for.`,
      );
    }
    const vault = Boolean(plan?.details?.vault);
    const yoloed = ask && !vault ? await yoloOnce(call) : false;
    const verdict =
      ask && !yoloed && this.#reviewer && !vault
        ? await reviewOnce(call, this.#reviewer, this.#ownerUserId)
        : undefined;
    const auto = yoloed || verdict?.approve === true;
    let waitedMs: number | undefined;
    if (ask && !auto) {
      const waitStarted = Date.now();
      const decision = await this.#waitForOwner(call, plan);
      waitedMs = await api.memo("gate:waited", Date.now() - waitStarted, context);
      if (decision !== "approved") {
        await hooks?.settled?.(args, api, context, decision).catch(() => undefined);
        return declinedResult(name, decision, waitedMs);
      }
      await api.memo("gate:approved", true, context);
    }
    const replaySafe = call.replaySafe || hooks?.replaySafe?.(args) === true;
    if (!replaySafe) {
      if (await api.memo<boolean>("gate:effect", context)) {
        return {
          output: text(`Tool ${name} was interrupted by a restart and may have partially run.`),
          isError: true,
          details: {
            interrupted: true,
            ...(ask ? { approval: yoloed ? "yolo" : auto ? "auto" : "approved" } : {}),
            ...(waitedMs !== undefined ? { waitedMs } : {}),
          },
        };
      }
      await api.memo("gate:effect", true, context);
    }
    const result = scrubResult(await execute());
    if (!ask) return result;
    return {
      ...result,
      details: yoloed
        ? { approval: "yolo", result: result.details ?? null }
        : auto
          ? {
              approval: "auto",
              review: toJson(verdict),
              result: result.details ?? null,
            }
          : { approval: "approved", waitedMs: waitedMs ?? 0, result: result.details ?? null },
    };
  }

  async #overBudget(call: GateCall): Promise<{ used: number; budget: number } | undefined> {
    const { api, context } = call;
    const state = await tokenBudget(api, context);
    if (!state) return undefined;
    const decided = await api.memo<{ used: number; budget: number } | null>(
      "gate:budget",
      state.used >= state.budget ? state : null,
      context,
    );
    if (!decided) return undefined;
    if (decided.used >= decided.budget * BUDGET_STOP_FACTOR) {
      this.#stop?.(Number(api.conversationId));
    }
    return decided;
  }

  async #overRunCap(call: GateCall): Promise<boolean> {
    const { api, context } = call;
    if (!call.run) return false;
    const decided = await api.memo<boolean>("gate:run-cap", context);
    if (decided !== undefined) return decided;
    const key = await call.run();
    if (key === undefined) return false;
    const count = (this.#runCalls.get(key) ?? 0) + 1;
    this.#runCalls.delete(key);
    this.#runCalls.set(key, count);
    if (this.#runCalls.size > RUN_COUNTS_KEPT) {
      const oldest = this.#runCalls.keys().next().value;
      if (oldest !== undefined) this.#runCalls.delete(oldest);
    }
    const over = await api.memo("gate:run-cap", count > RUN_TOOL_CALL_LIMIT, context);
    if (over && count > RUN_TOOL_CALL_LIMIT + RUN_STOP_AFTER) {
      this.#stop?.(Number(api.conversationId));
    }
    return over;
  }

  async decide(
    conversation: number,
    taskId: number,
    decision: ApprovalDecision,
    options: { grant?: boolean } = {},
  ): Promise<void> {
    const held = this.#held.get(heldKey(conversation, taskId));
    if (!held) return this.#store.decide(conversation, taskId, decision, options);
    if (decision === "approved" && options.grant && held.grant) {
      await this.#store.grant(conversation, held.grant);
    }
    held.settle(decision);
  }

  async approveWaiting(
    conversation: number,
    by: number | undefined,
    userMessages: () => Promise<readonly GateUserMessage[]>,
  ): Promise<number[]> {
    if (this.#approvals.count(conversation) === 0) return [];
    if (!ownerTurn(await userMessages(), by)) return [];
    const approved: number[] = [];
    for (const taskId of this.#approvals.tasks(conversation)) {
      const held = this.#held.get(heldKey(conversation, taskId));
      if (held) {
        if (held.vault) continue;
        held.settle("approved");
        approved.push(taskId);
        continue;
      }
      try {
        await this.#store.approveForYolo(conversation, taskId);
        approved.push(taskId);
      } catch {}
    }
    return approved;
  }

  abandon(conversation: number): void {
    for (const [key, held] of this.#held) {
      if (key.startsWith(`${conversation}:`)) held.abandon();
    }
  }

  #waitForOwner(call: GateCall, plan: GatePlan | undefined): Promise<ApprovalDecision | "expired"> {
    if (call.answers === "document") {
      return waitForApproval(call.api, this.#approvals, call.name, call.context, plan);
    }
    return this.#holdForOwner(call, plan);
  }

  async #holdForOwner(
    call: GateCall,
    plan: GatePlan | undefined,
  ): Promise<ApprovalDecision | "expired"> {
    const conversation = Number(call.api.conversationId);
    const taskId = Number(call.api.taskId);
    const key = heldKey(conversation, taskId);
    const expiresAt = plan?.expiresInMs ? Date.now() + plan.expiresInMs : undefined;
    const info: WaitInfo = {
      ...approvalWaitInfo(call.name, plan),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
    await call.api.details(
      {
        approval: "pending",
        ...plan?.details,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      } as JsonObject,
      call.context,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<ApprovalDecision | "expired">((resolve, reject) => {
        const settle = (decision: ApprovalDecision | "expired") => {
          this.#held.delete(key);
          resolve(decision);
        };
        this.#held.set(key, {
          vault: Boolean(plan?.details?.vault),
          ...(plan?.grant ? { grant: plan.grant } : {}),
          settle,
          abandon: () => {
            this.#held.delete(key);
            reject(new Error(`The reply ended before the owner answered this ${call.name} call.`));
          },
        });
        this.#approvals.add(conversation, taskId, info);
        if (expiresAt !== undefined) {
          timer = setTimeout(() => settle("expired"), expiresAt - Date.now());
          timer.unref?.();
        }
      });
    } finally {
      clearTimeout(timer);
      this.#held.delete(key);
      this.#approvals.remove(conversation, taskId);
    }
  }
}

export function ranToResult(result: ToolExecutionResult | ToolPark): ToolExecutionResult {
  if ("sleep" in result || "wait" in result) throw new Error("tool parked outside the gate");
  return result;
}

function scrubResult(result: ToolExecutionResult): ToolExecutionResult {
  if (secretRedactor.size === 0) return result;
  return {
    ...result,
    output: result.output?.map((block) =>
      block.type === "text" ? { ...block, text: secretRedactor.scrub(block.text) } : block,
    ),
    ...(result.details !== undefined ? { details: secretRedactor.scrubJson(result.details) } : {}),
  };
}

const planMemo = durableMemo<GatePlan>(
  "gate:plan",
  z.object({
    refuse: z.string().optional(),
    ask: z.boolean(),
    details: z.record(z.string(), z.json()).optional(),
    grant: z.string().optional(),
    expiresInMs: z.number().optional(),
  }),
);

async function planOnce(call: GateCall, hooks: GateHooks<unknown>): Promise<GatePlan> {
  const { api, context } = call;
  const stored = await planMemo.read(api, context);
  if (stored) return stored;
  const toolAsks = await mustAsk(call.name, api, context);
  return planMemo.keep(api, await hooks.plan(call.args, api, context, toolAsks), context);
}

async function yoloOnce(call: GateCall): Promise<boolean> {
  const { api, context } = call;
  const stored = await api.memo<boolean>("gate:yolo", context);
  if (stored !== undefined) return stored;
  const state = await yoloOf(api, context);
  const decided = state.on && ownerTurn(await call.userMessages(), state.by);
  return api.memo("gate:yolo", decided, context);
}

const reviewMemo = durableMemo<ReviewVerdict>(
  "gate:review",
  z.object({
    approve: z.boolean(),
    classifier: z.string(),
    requested: z.number().optional(),
    risk: z.number().optional(),
    error: z.string().optional(),
  }),
);

async function reviewOnce(
  call: GateCall,
  reviewer: Reviewer,
  ownerUserId: () => Promise<number | undefined>,
): Promise<ReviewVerdict | undefined> {
  const { api, context } = call;
  const stored = await reviewMemo.read(api, context);
  if (stored) return stored;
  if (!(await mayAutoReview(call.name, api, context))) return undefined;
  let owner: number | undefined;
  try {
    owner = await ownerUserId();
  } catch {
    return undefined;
  }
  const messages = ownerMessages(await call.userMessages(), owner);
  if (!messages) return undefined;
  const verdict = await reviewer({
    tool: call.name,
    args: call.args,
    instructions: await call.instructions(),
    ownerMessages: messages,
  });
  return reviewMemo.keep(api, verdict, context);
}
