/**
 * The Tool gate: the one place a bot's tool call is let through, whichever
 * engine runs the conversation (ADR 0014). Each engine adapts its own call
 * to a `GateCall` and hands the gate the tool's run; the gate decides, in
 * this order and once per call:
 *
 * 1. The tool's gate plan (its `gate`, vault sinks and the like) may
 *    refuse the call, or ask whatever the tool's permission says.
 * 2. Otherwise the conversation's permissions (`tiny.permissions`) say
 *    whether the call asks the owner.
 * 3. A conversation nobody watches never asks: the call is refused.
 * 4. YOLO mode (`tiny.yolo`) runs an asking call without a card in the
 *    owner's own turns, never a vault use.
 * 5. Auto-review may run an asking call the owner clearly asked for, in
 *    the owner's own turns (a guest's message is not the owner's), never a
 *    vault use.
 * 6. Anything still asking waits for the owner: counted by the runtime's
 *    approvals `WaitTracker` (the Bot list badge, push notifications), with
 *    the answer kept in a task document (pi, survives a restart) or in
 *    memory (the Claude plan engine).
 * 7. The result leaves the gate scrubbed of registered vault values.
 *
 * Before all of that, a conversation with a token budget (a routine run's)
 * that has used it up refuses every call, so the model answers with what it
 * has; one far past it is stopped. Likewise a run (one reply, through all
 * its tool rounds) past `RUN_TOOL_CALL_LIMIT` calls is refused, and stopped
 * if it keeps calling: a stuck loop must not run until someone presses Stop.
 *
 * Every decision is memoized on the call's api (`gate:*`), so a replay after
 * a restart, or a permission change mid-call, never flips it.
 */
import type { Context } from "@earendil-works/chord";
import type { JsonObject, ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
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

/** One tool call as an engine hands it to the gate. */
export interface GateCall {
  readonly name: string;
  readonly args: unknown;
  /** The tool may run again after a restart (pi's `replay: "safe"`). */
  readonly replaySafe: boolean;
  /** The tool's own say in its gate (its registration's `gate`), if any. */
  readonly hooks: GateHooks<unknown> | undefined;
  /**
   * The call's tool api: its decided-once memos, the conversation's
   * documents (permissions, YOLO, grants) and the details the chat shows.
   * A pi task's, or the Claude plan engine's partial one. The tool's plan
   * hooks see the same api.
   */
  readonly api: ToolExecutionApi;
  readonly context: Context;
  /**
   * Where the owner's answer is kept: `document`, the call's
   * `tiny.approval` task document the host writes (pi; a restart re-attaches
   * to it), or `memory`, held by the gate until `decide()`.
   */
  readonly answers: "document" | "memory";
  /** The conversation's user messages, newest first: whose turn it is and what the owner asked. */
  userMessages(): Promise<readonly GateUserMessage[]>;
  /**
   * A key for the run (the reply) this call belongs to, so the gate can cap
   * its tool calls; undefined, or absent (the Claude plan, which has its own
   * `maxTurns`), means no cap.
   */
  run?(): Promise<string | undefined>;
  /** The bot's instructions, for auto-review. */
  instructions(): Promise<string | undefined>;
}

/**
 * The host side of answers kept in the durable store (pi's harness). The
 * runtime implements it; a gate without one only answers calls it holds in
 * memory.
 */
export interface GateStore {
  /** Record the owner's decision. Throws `ApprovalNotPendingError` for a call not waiting. */
  decide(
    conversation: number,
    taskId: number,
    decision: ApprovalDecision,
    options: { grant?: boolean },
  ): Promise<void>;
  /** YOLO mode approves a waiting call. Throws for a call it does not answer (a vault use, a question, …). */
  approveForYolo(conversation: number, taskId: number): Promise<void>;
  /** Record a standing grant for the conversation ("Approve for this conversation"). */
  grant(conversation: number, grant: string): Promise<void>;
}

export interface ToolGateOptions {
  /** Counts calls waiting on the owner's approval (shared with credential requests). */
  approvals: WaitTracker;
  /**
   * Stop the conversation's run: called (not awaited) when a budgeted
   * conversation keeps calling tools far past its budget.
   */
  stop?: (conversation: number) => void;
  /** Auto-review (issue #65); without one every asking call shows its card. */
  reviewer?: Reviewer;
  /**
   * The owner's user id. In a shared chat auto-review reads only their
   * messages, as YOLO trusts only its `by` (S6); without one, no message
   * with an author counts as the owner's.
   */
  ownerUserId?: () => Promise<number | undefined>;
  store?: GateStore;
}

/** An approval the gate holds in memory, until `decide()` or the turn ends. */
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

/** Past this multiple of its budget, a conversation's run is stopped, not just refused tools. */
const BUDGET_STOP_FACTOR = 1.5;

/** Tool calls one run (a reply, through all its tool rounds) may make. */
const RUN_TOOL_CALL_LIMIT = 150;
/** Calls past the limit after which the run is stopped, not just refused. */
const RUN_STOP_AFTER = 20;
/** Runs whose calls are counted at once; the oldest is forgotten past this. */
const RUN_COUNTS_KEPT = 500;

function runCapRefusal(name: string): string {
  return (
    `${name} did not run: this reply has already made ${RUN_TOOL_CALL_LIMIT} tool calls, ` +
    `the most one reply may make. Do not call any more tools. ` +
    `Reply now with what you have, say what was left undone, and let the owner decide how to go on.`
  );
}

/** The refusal a call gets once its conversation has spent its token budget. */
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
  /** Tool calls per run key, counted once per call. */
  readonly #runCalls = new Map<string, number>();

  constructor(options: ToolGateOptions) {
    this.#approvals = options.approvals;
    this.#stop = options.stop;
    this.#reviewer = options.reviewer;
    this.#ownerUserId = options.ownerUserId ?? (async () => undefined);
    this.#store = options.store ?? noStore;
  }

  /** Calls of the conversation waiting for the owner's approval. */
  waiting(conversation: number): number {
    return this.#approvals.count(conversation);
  }

  /** Let one tool call through: `execute` runs only once the gate allows it. */
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
    // Decided once per call, so a permission change mid-call can't flip it on replay.
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
    // Vault uses always reach the owner: their policy, not YOLO or the classifier, decides.
    const vault = Boolean(plan?.details?.vault);
    const yoloed = ask && !vault ? await yoloOnce(call) : false;
    const verdict =
      ask && !yoloed && this.#reviewer && !vault
        ? await reviewOnce(call, this.#reviewer, this.#ownerUserId)
        : undefined;
    const auto = yoloed || verdict?.approve === true;
    // How long the call sat on the owner, so its duration can leave that out.
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
    // The pending card's details must not outlive the decision.
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

  /**
   * The conversation's budget and use when it has spent its budget (decided
   * once per call, so a replay keeps the answer); stops the run when it is
   * far past it.
   */
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

  /**
   * Whether this call is past its run's tool-call limit. Counted and decided
   * once per call (a replay keeps the answer); a run that keeps calling well
   * past the limit is stopped. Counts live in memory: a restart starts them
   * over, which only ever allows more.
   */
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

  /**
   * The owner's answer to a waiting call (`taskId` from the chat's tool
   * call). With `grant`, an approval also records the standing grant the
   * card offered. Throws `ApprovalNotPendingError` when it is not waiting.
   */
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

  /**
   * YOLO mode was switched on: approve the calls already waiting that it
   * would have run (never a vault use, and only in the owner's turn, `by`
   * in a shared chat). Returns their task ids.
   */
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
      } catch {
        // Not an approval YOLO answers (a vault use, a question, a
        // credential request) or no longer waiting: it stays as it is.
      }
    }
    return approved;
  }

  /** The conversation's turn ended: answers held in memory will never come. */
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

  /** Wait for the owner with the answer held here (engines without task documents). */
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

/**
 * Whether YOLO mode runs this call, decided once (a replay or a toggle
 * mid-call never flips it): on, and the turn is the owner's.
 */
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

/**
 * Auto-review a call that would ask, once: `undefined` when the conversation
 * does not let auto-review approve this tool, or the turn is not the owner's
 * (another bot's or a guest's) or no owner message is in reach (the card
 * shows as before). A verdict is memoized before it is acted on.
 */
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
    return undefined; // Whose turn it is can't be told: the owner gets the card.
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
