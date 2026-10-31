/**
 * Tool approvals (issue #1 D3/D4): the owner-wait of a gated tool call, end
 * to end. This module owns the approval's document, the card details the
 * chat renders (produced and parsed here, nowhere else), the host side that
 * records the owner's decision, and the gate that wraps every capability
 * tool:
 *
 * - A conversation's `tiny.permissions` document (`policy.ts`) lists the
 *   tools that run without asking. A conversation without the document
 *   predates permissions and runs everything.
 * - A tool that must ask waits on its task-scoped `tiny.approval` document
 *   (`waitForOwner`, see `waiting.ts`), publishing `{ approval: "pending" }`
 *   details until the host records a decision (`recordDecision`, reached
 *   through `AgentRuntime.decideApproval`). Only a call that is waiting can
 *   be decided: the document is marked `asked` by the wait itself, so a
 *   decision for a running call that never asked is refused.
 * - The side effect itself keeps the wrapped tool's replay policy: for a tool
 *   that is not replay-safe, a durable memo records that the effect started, so
 *   a crash during it reports "interrupted" instead of running it twice. A
 *   tool whose call is replay-safe for some arguments says so (`replaySafe`).
 * - A tool can carry a gate plan (`withGatePlan`, used by vault sinks, issue
 *   #56): decided once per call before anything runs, it may refuse the call,
 *   ask even where the tool is allowed, add to the card, offer a standing
 *   grant for the conversation and let the approval expire.
 * - With a reviewer (auto-review, issue #65), a call that would ask the owner
 *   is first judged by a classifier for the tools the conversation's
 *   permissions list under `review`; an approval skips the card. Vault calls
 *   always ask. The verdict is memoized, so a replay never re-asks.
 * - A conversation nobody watches (`unattended`, a routine's, issue #63)
 *   never asks: a call that would wait for the owner is refused instead
 *   (`refuseUnattended`), which a Routine run reads as blocked.
 * - Every result leaves the gate scrubbed of registered secret values.
 */
import type { Context } from "@earendil-works/chord";
import {
  defineDoc,
  type Extension,
  type TaskId,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { JsonObject } from "@earendil-works/pi-durable";
import { isUnattendedConversation, mayAutoReview, mustAsk, PermissionsDoc } from "./policy";
import { secretRedactor } from "./redact";
import { ownerMessages, type GateReview, type ReviewVerdict } from "./reviewer";
import type { ChatVaultUse } from "./types";
import { GrantsDoc } from "./vault";
import {
  pendingToolTask,
  refuseUnattended,
  sealedAsNotPending,
  unattendedOnce,
  waitForOwner,
  type HostTx,
  type WaitTracker,
} from "./waiting";

// Read by tools that decide their own unattended behaviour (routines, browser).
export { isUnattendedConversation, PermissionsDoc };

export type ApprovalDecision = "approved" | "denied";

/**
 * One gated tool call's approval, owned by its tool task. `asked` is set by
 * the wait that created it: a document a host answer would create itself
 * (for a call that never asked) has it unset, and the answer is refused.
 * `grant` is the standing grant the card offers; `expiresAt` makes it settle
 * as `expired`.
 */
export const ApprovalDoc = defineDoc<{
  status: "pending" | ApprovalDecision | "expired";
  asked?: boolean;
  grant?: string;
  expiresAt?: number;
}>({
  kind: "tiny.approval",
  version: 1,
  scope: "task",
  initial: () => ({ status: "pending" }),
  checkpointWhen: () => false,
});

/** The approval was already answered, or its tool call ended or never asked. */
export class ApprovalNotPendingError extends Error {
  constructor(taskId: number) {
    super(`Tool call ${taskId} is not waiting for approval`);
    this.name = "ApprovalNotPendingError";
  }
}

// ── The card's details: one shape, produced and parsed here ─────────────

/** How a gated call stands with the owner, as its tool details say it. */
export type ApprovalState = "pending" | "approved" | "denied" | "expired" | "auto" | "refused";

/** What the chat reads off a gated call's details. */
export interface ApprovalView {
  state: ApprovalState;
  /** Time the call waited for the owner (not part of its run time). */
  waitedMs?: number;
  /** Pending only: when the approval expires. */
  expiresAt?: number;
  /** Pending vault calls: the item and target the card shows. */
  vault?: ChatVaultUse;
  /** The wrapped tool's own details, once it ran. */
  result?: unknown;
  /** The call was cut off by a restart after approval. */
  interrupted?: boolean;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const APPROVAL_STATES: ReadonlySet<string> = new Set([
  "pending",
  "approved",
  "denied",
  "expired",
  "auto",
  "refused",
]);

/** The approval view of a tool call's details; undefined for a call that never asked. */
export function approvalOf(details: unknown): ApprovalView | undefined {
  const own = record(details);
  const state = own?.approval;
  if (typeof state !== "string" || !APPROVAL_STATES.has(state)) return undefined;
  const vault = record(own?.vault);
  return {
    state: state as ApprovalState,
    ...(typeof own?.waitedMs === "number" ? { waitedMs: own.waitedMs } : {}),
    ...(typeof own?.expiresAt === "number" ? { expiresAt: own.expiresAt } : {}),
    ...(state === "pending" && vault && typeof vault.handle === "string"
      ? { vault: vault as unknown as ChatVaultUse }
      : {}),
    ...(own && "result" in own ? { result: own.result } : {}),
    ...(own?.interrupted === true ? { interrupted: true } : {}),
  };
}

/**
 * The wrapped tool's own details, for parsers of other wait kinds: a tool
 * that asked first keeps its details under `result`; one that did not has
 * them at the top.
 */
export function innerDetails(details: unknown): Record<string, unknown> | undefined {
  const own = record(details);
  if (!own) return undefined;
  return own.approval !== undefined && "result" in own ? record(own.result) : own;
}

const text = (value: string) => [{ type: "text" as const, text: value }];

/** A gated call's result once the owner declined, in either way. */
function declinedResult(
  tool: string,
  decision: "denied" | "expired",
  waitedMs: number,
): ToolExecutionResult {
  return {
    output: text(
      decision === "expired"
        ? `Nobody answered the approval for this ${tool} call in time, so it did not run. Tell the owner what you needed; do not retry it unless asked.`
        : `The owner denied this ${tool} call. Do not retry it unless asked.`,
    ),
    isError: true,
    details: { approval: decision, waitedMs },
  };
}

// ── Host side: the owner's decision ─────────────────────────────────────

/**
 * Record the owner's decision on a waiting call, in the host's transaction.
 * With `grant`, an approval also records the standing grant the card
 * offered. Throws `ApprovalNotPendingError` for a call that is not waiting:
 * already decided, ended, never asked (the document was never marked
 * `asked` by a wait) or still planning.
 */
export async function recordDecision(
  tx: HostTx,
  conversation: number,
  taskId: number,
  decision: ApprovalDecision,
  options: { grant?: boolean } = {},
): Promise<void> {
  const id = taskId as TaskId;
  const notPending = () => new ApprovalNotPendingError(taskId);
  await pendingToolTask(tx, id, conversation, notPending);
  const doc = await tx.doc(ApprovalDoc, id);
  if (doc.asked !== true || doc.status !== "pending") throw notPending();
  doc.status = decision;
  if (decision === "approved" && options.grant && doc.grant) {
    const grants = await tx.doc(GrantsDoc, conversation as never);
    if (!grants.grants.includes(doc.grant)) grants.grants.push(doc.grant);
  }
}

/** Map a sealed-document error (the call ended) to `ApprovalNotPendingError`. */
export function approvalNotPending(error: unknown, taskId: number): never {
  if (error instanceof ApprovalNotPendingError) throw error;
  return sealedAsNotPending(error, () => new ApprovalNotPendingError(taskId));
}

// ── The gate ────────────────────────────────────────────────────────────

/** A tool's own say in its gate, decided once per call (memoized for replays). */
export interface GatePlan {
  /** Refuse the call with this model-facing text; nothing runs, nobody is asked. */
  refuse?: string;
  /** Ask the owner (decided by the plan, whatever the tool's permission). */
  ask: boolean;
  /** Merged into the pending card's details. */
  details?: JsonObject;
  /** Standing grant "Approve for this conversation" records. */
  grant?: string;
  /** The approval settles as expired after this long unanswered. */
  expiresInMs?: number;
}

export interface GateHooks<TArgs = never> {
  /** `toolAsks`: the tool's own permission would ask. */
  plan(args: TArgs, api: ToolExecutionApi, context: Context, toolAsks: boolean): Promise<GatePlan>;
  /** The owner denied the call, or the approval expired. */
  settled?(
    args: TArgs,
    api: ToolExecutionApi,
    context: Context,
    decision: "denied" | "expired",
  ): Promise<void>;
  /**
   * The call is replay-safe for these arguments even though the tool is not
   * (it only waits on the owner, e.g. `browser_enter_code` without a vault
   * handle): a restart re-attaches instead of reporting "interrupted".
   */
  replaySafe?(args: TArgs): boolean;
}

const gateHooks = new WeakMap<ToolRegistration, GateHooks<never>>();

/** Attach gate hooks to a tool registration (identity otherwise). */
export function withGatePlan<T extends ToolRegistration>(
  tool: T,
  hooks: GateHooks<Parameters<T["execute"]>[0]>,
): T {
  gateHooks.set(tool, hooks as GateHooks<never>);
  return tool;
}

/** Whether the owner approved this call at its gate (for tools whose sink re-checks). */
export async function gateApproved(api: ToolExecutionApi, context: Context): Promise<boolean> {
  return (await api.memo<boolean>("gate:approved", context)) ?? false;
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

/** Wrap every tool of an extension in the approval gate. */
export function gateExtension(
  extension: Extension,
  tracker: WaitTracker,
  review?: GateReview,
): Extension {
  return {
    ...extension,
    tools: extension.tools?.map((tool) => gateTool(tool, tracker, review)),
  };
}

export function gateTool(
  tool: ToolRegistration,
  tracker: WaitTracker,
  review?: GateReview,
): ToolRegistration {
  const hooks = gateHooks.get(tool);
  return {
    ...tool,
    replay: "safe",
    async execute(args, api, context): Promise<ToolExecutionResult> {
      const plan = hooks ? await planOnce(tool.name, hooks, args, api, context) : undefined;
      if (plan?.refuse) {
        return { output: text(plan.refuse), isError: true, details: { refused: true } };
      }
      // Decided once per call, so a permission change mid-call can't flip it on replay.
      const ask = await api.memo(
        "gate:ask",
        plan ? plan.ask : await mustAsk(tool.name, api, context),
        context,
      );
      if (ask && (await unattendedOnce(api, context))) {
        return refuseUnattended(
          `${tool.name} needs the owner's approval, and nobody is here to give it: this is a scheduled routine run. It did not run. Finish without it and say what it was for.`,
        );
      }
      // Vault uses always reach the owner: their policy, not the classifier, decides.
      const verdict =
        ask && review && !plan?.details?.vault
          ? await reviewOnce(tool.name, review, args, api, context)
          : undefined;
      const auto = verdict?.approve === true;
      // How long the call sat on the owner, so its duration can leave that out.
      let waitedMs: number | undefined;
      if (ask && !auto) {
        const waitStarted = Date.now();
        const decision = await waitForDecision(api, tracker, tool.name, context, plan);
        waitedMs = await api.memo("gate:waited", Date.now() - waitStarted, context);
        if (decision !== "approved") {
          await hooks?.settled?.(args as never, api, context, decision).catch(() => undefined);
          return declinedResult(tool.name, decision, waitedMs);
        }
        await api.memo("gate:approved", true, context);
      }
      const replaySafe = tool.replay === "safe" || hooks?.replaySafe?.(args as never) === true;
      if (!replaySafe) {
        if (await api.memo<boolean>("gate:effect", context)) {
          return {
            output: text(
              `Tool ${tool.name} was interrupted by a restart and may have partially run.`,
            ),
            isError: true,
            details: {
              interrupted: true,
              ...(ask ? { approval: auto ? "auto" : "approved" } : {}),
              ...(waitedMs !== undefined ? { waitedMs } : {}),
            },
          };
        }
        await api.memo("gate:effect", true, context);
      }
      const result = scrubResult(await tool.execute(args, api, context));
      // The pending card's details must not outlive the decision.
      if (!ask) return result;
      return {
        ...result,
        details: auto
          ? {
              approval: "auto",
              review: verdict as unknown as JsonObject,
              result: result.details ?? null,
            }
          : { approval: "approved", waitedMs: waitedMs ?? 0, result: result.details ?? null },
      };
    },
  };
}

async function planOnce(
  name: string,
  hooks: GateHooks<never>,
  args: unknown,
  api: ToolExecutionApi,
  context: Context,
): Promise<GatePlan> {
  const stored = await api.memo<JsonObject>("gate:plan", context);
  if (stored) return stored as unknown as GatePlan;
  const toolAsks = await mustAsk(name, api, context);
  const plan = await hooks.plan(args as never, api, context, toolAsks);
  const json = JSON.parse(JSON.stringify(plan)) as JsonObject;
  return (await api.memo("gate:plan", json, context)) as unknown as GatePlan;
}

/**
 * Auto-review a call that would ask, once: `undefined` when the conversation
 * does not let auto-review approve this tool or no owner message is in reach
 * (the card shows as before). A verdict is memoized before it is acted on.
 */
async function reviewOnce(
  name: string,
  review: GateReview,
  args: unknown,
  api: ToolExecutionApi,
  context: Context,
): Promise<ReviewVerdict | undefined> {
  const stored = await api.memo<JsonObject>("gate:review", context);
  if (stored) return stored as unknown as ReviewVerdict;
  if (!(await mayAutoReview(name, api, context))) return undefined;
  const messages = ownerMessages(await review.recentEntries(Number(api.conversationId)));
  if (!messages) return undefined;
  const { instructions } = await api.agent(context);
  const verdict = await review.reviewer({
    tool: name,
    args,
    instructions,
    ownerMessages: messages,
  });
  // A verdict is flat JSON; only its unset fields must go before it is stored.
  const json = Object.fromEntries(
    Object.entries(verdict).filter(([, value]) => value !== undefined),
  ) as JsonObject;
  return (await api.memo("gate:review", json, context)) as unknown as ReviewVerdict;
}

/**
 * What a vault call's push names: the item and the target's host only (the
 * phishing tell), never the full target or any value.
 */
function vaultSubject(plan: GatePlan | undefined): { subject?: string } {
  const vault = plan?.details?.vault as { label?: unknown; target?: unknown } | undefined;
  if (!vault || typeof vault.label !== "string") return {};
  let host: string | undefined;
  try {
    host =
      typeof vault.target === "string"
        ? new URL(vault.target).hostname.replace(/^www\./, "")
        : undefined;
  } catch {
    host = undefined;
  }
  return { subject: host ? `${vault.label} on ${host}` : vault.label };
}

async function waitForDecision(
  api: ToolExecutionApi,
  tracker: WaitTracker,
  tool: string,
  context: Context,
  plan?: GatePlan,
): Promise<ApprovalDecision | "expired"> {
  const doc = await waitForOwner(
    api,
    tracker,
    ApprovalDoc,
    (value) =>
      ({
        approval: "pending",
        ...plan?.details,
        ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt } : {}),
      }) as JsonObject,
    context,
    (value) => {
      // The wait marks the document: only a call that asked can be decided.
      value.asked = true;
      if (plan?.grant && value.grant === undefined) value.grant = plan.grant;
      if (plan?.expiresInMs && value.expiresAt === undefined) {
        value.expiresAt = Date.now() + plan.expiresInMs;
      }
    },
    { tool, ...vaultSubject(plan) },
  );
  return doc.status as ApprovalDecision | "expired";
}
