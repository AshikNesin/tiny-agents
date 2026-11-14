/**
 * Tool approvals (issue #1 D3/D4): the owner-wait of a gated tool call. This
 * module owns the approval's document, the card details the chat renders
 * (produced and parsed here, nowhere else), the host side that records the
 * owner's decision, and a tool's own say in its gate. The Tool gate
 * (`gate.ts`) decides when a call asks; this is what asking is made of:
 *
 * - A call that asks waits on its task-scoped `tiny.approval` document
 *   (`waitForApproval`, see `waiting.ts`), publishing `{ approval: "pending" }`
 *   details until the host records a decision (`recordDecision`, reached
 *   through `AgentRuntime.decideApproval`). Only a call that is waiting can
 *   be decided: the document is marked `asked` by the wait itself, so a
 *   decision for a running call that never asked is refused. An engine
 *   without task documents (the Claude plan) has the gate hold the answer
 *   instead, with the same card details.
 * - A tool can carry a gate plan (its declaration's `gate`, used by vault
 *   sinks, issue #56): decided once per call before anything runs, it may
 *   refuse the call, ask even where the tool is allowed, add to the card,
 *   offer a standing grant for the conversation and let the approval
 *   expire.
 * - YOLO mode switched on approves calls already waiting
 *   (`recordYoloDecision`), never a vault use.
 */
import type { Context } from "@earendil-works/chord";
import {
  defineDoc,
  type ConversationId,
  type TaskId,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { JsonObject } from "@earendil-works/pi-durable";
import { z } from "zod";
import { isUnattendedConversation } from "./policy";
import type { ChatVaultUse } from "./types";
import { GrantsDoc, VAULT_KINDS } from "./vault";
import {
  pendingToolTask,
  sealedAsNotPending,
  waitForOwner,
  type HostTx,
  type WaitInfo,
  type WaitTracker,
} from "./waiting";

// Read by tools that decide their own unattended behaviour (routines, browser).
export { isUnattendedConversation };

export type ApprovalDecision = "approved" | "denied";

/**
 * One gated tool call's approval, owned by its tool task. `asked` is set by
 * the wait that created it: a document a host answer would create itself
 * (for a call that never asked) has it unset, and the answer is refused.
 * `grant` is the standing grant the card offers; `expiresAt` makes it settle
 * as `expired`.
 */
const ApprovalDoc = defineDoc<{
  status: "pending" | ApprovalDecision | "expired";
  asked?: boolean;
  grant?: string;
  expiresAt?: number;
  /** The call uses a vault item: YOLO never answers it. */
  vault?: boolean;
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
type ApprovalState = "pending" | "approved" | "denied" | "expired" | "auto" | "yolo" | "refused";

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
  "yolo",
  "refused",
]);

const chatVaultUse: z.ZodType<ChatVaultUse> = z.object({
  handle: z.string(),
  label: z.string(),
  kind: z.enum(VAULT_KINDS),
  tool: z.string(),
  target: z.string(),
  bot: z.string().optional(),
  card: z.object({ brand: z.string(), last4: z.string() }).optional(),
  username: z.string().optional(),
  grantable: z.boolean(),
  env: z.array(z.string()).optional(),
  hosts: z.array(z.string()).optional(),
});

/** The approval view of a tool call's details; undefined for a call that never asked. */
export function approvalOf(details: unknown): ApprovalView | undefined {
  const own = record(details);
  const state = own?.approval;
  if (typeof state !== "string" || !APPROVAL_STATES.has(state)) return undefined;
  const vault =
    state === "pending" && own?.vault !== undefined ? chatVaultUse.safeParse(own.vault) : undefined;
  if (vault && !vault.success) {
    console.warn(
      `Pending approval details "vault" does not fit its shape, so the card shows without it: ${z.prettifyError(vault.error)}`,
    );
  }
  return {
    state: state as ApprovalState,
    ...(typeof own?.waitedMs === "number" ? { waitedMs: own.waitedMs } : {}),
    ...(typeof own?.expiresAt === "number" ? { expiresAt: own.expiresAt } : {}),
    ...(vault?.success ? { vault: vault.data } : {}),
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
export function declinedResult(
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
    const grants = await tx.doc(GrantsDoc, conversation as ConversationId);
    if (!grants.grants.includes(doc.grant)) grants.grants.push(doc.grant);
  }
}

/**
 * YOLO mode switched on (issue #151): approve one call already waiting, in
 * the host's transaction, unless it uses a vault item. Throws
 * `ApprovalNotPendingError` for anything else (not waiting, not an
 * approval, a vault use), so the caller's commit changes nothing.
 */
export async function recordYoloDecision(
  tx: HostTx,
  conversation: number,
  taskId: number,
): Promise<void> {
  const id = taskId as TaskId;
  const notPending = () => new ApprovalNotPendingError(taskId);
  await pendingToolTask(tx, id, conversation, notPending);
  const doc = await tx.doc(ApprovalDoc, id);
  if (doc.asked !== true || doc.status !== "pending" || doc.vault === true) throw notPending();
  doc.status = "approved";
}

/** Map a sealed-document error (the call ended) to `ApprovalNotPendingError`. */
export function approvalNotPending(error: unknown, taskId: number): never {
  if (error instanceof ApprovalNotPendingError) throw error;
  return sealedAsNotPending(error, () => new ApprovalNotPendingError(taskId));
}

// ── A tool's own say in its gate ────────────────────────────────────────

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

/**
 * A tool registration with its gate plan as a field: `tool()` (`toolkit.ts`)
 * sets it from the tool's declaration, and both engines hand it to the Tool
 * gate. pi-durable ignores the field.
 */
type GatedRegistration = ToolRegistration & { readonly gate?: GateHooks<unknown> };

/** The gate hooks a tool registration carries, if any. */
export function gateHooksOf(tool: ToolRegistration): GateHooks<unknown> | undefined {
  return (tool as GatedRegistration).gate;
}

/** Whether the owner approved this call at its gate (for tools whose sink re-checks). */
export async function gateApproved(api: ToolExecutionApi, context: Context): Promise<boolean> {
  return (await api.memo<boolean>("gate:approved", context)) ?? false;
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

/** What the approvals tracker's listeners (push notifications) learn about a waiting call. */
export function approvalWaitInfo(tool: string, plan: GatePlan | undefined): WaitInfo {
  return { tool, ...vaultSubject(plan) };
}

/**
 * Wait on the call's `tiny.approval` document until the owner decides (or
 * it expires), counted by `tracker` and showing the card meanwhile. A
 * re-run after a restart re-attaches to the same document.
 */
export async function waitForApproval(
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
      if (plan?.details?.vault) value.vault = true;
      if (plan?.grant && value.grant === undefined) value.grant = plan.grant;
      if (plan?.expiresInMs && value.expiresAt === undefined) {
        value.expiresAt = Date.now() + plan.expiresInMs;
      }
    },
    approvalWaitInfo(tool, plan),
  );
  return doc.status as ApprovalDecision | "expired";
}
