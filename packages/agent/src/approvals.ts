import type { Context } from "@earendil-works/chord/context";
import {
  defineDoc,
  type ConversationId,
  type TaskId,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolPark,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { JsonObject } from "@earendil-works/pi-durable";
import { z } from "zod";
import { isUnattendedConversation } from "./policy";
import type { ChatVaultUse } from "./types";
import { GrantsDoc, VAULT_KINDS } from "./vault";
import {
  isParked,
  parkForOwner,
  pendingToolTask,
  sealedAsNotPending,
  wakeOwnerWait,
  type HostTx,
  type WaitInfo,
  type WaitTracker,
} from "./waiting";

export { isUnattendedConversation };

export type ApprovalDecision = "approved" | "denied";

const ApprovalDoc = defineDoc<{
  status: "pending" | ApprovalDecision | "expired";
  asked?: boolean;
  grant?: string;
  expiresAt?: number;
  vault?: boolean;
}>({
  kind: "tiny.approval",
  version: 1,
  scope: "task",
  initial: () => ({ status: "pending" }),
  checkpointWhen: () => false,
});

export class ApprovalNotPendingError extends Error {
  constructor(taskId: number) {
    super(`Tool call ${taskId} is not waiting for approval`);
    this.name = "ApprovalNotPendingError";
  }
}

type ApprovalState = "pending" | "approved" | "denied" | "expired" | "auto" | "yolo" | "refused";

export interface ApprovalView {
  state: ApprovalState;
  waitedMs?: number;
  expiresAt?: number;
  vault?: ChatVaultUse;
  result?: unknown;
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

export function innerDetails(details: unknown): Record<string, unknown> | undefined {
  const own = record(details);
  if (!own) return undefined;
  return own.approval !== undefined && "result" in own ? record(own.result) : own;
}

const text = (value: string) => [{ type: "text" as const, text: value }];

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
  await wakeOwnerWait(tx, id);
  doc.status = decision;
  if (decision === "approved" && options.grant && doc.grant) {
    const grants = await tx.doc(GrantsDoc, conversation as ConversationId);
    if (!grants.grants.includes(doc.grant)) grants.grants.push(doc.grant);
  }
}

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
  await wakeOwnerWait(tx, id);
  doc.status = "approved";
}

export function approvalNotPending(error: unknown, taskId: number): never {
  if (error instanceof ApprovalNotPendingError) throw error;
  return sealedAsNotPending(error, () => new ApprovalNotPendingError(taskId));
}

export interface GatePlan {
  refuse?: string;
  ask: boolean;
  details?: JsonObject;
  grant?: string;
  expiresInMs?: number;
}

export interface GateHooks<TArgs = never> {
  plan(args: TArgs, api: ToolExecutionApi, context: Context, toolAsks: boolean): Promise<GatePlan>;
  settled?(
    args: TArgs,
    api: ToolExecutionApi,
    context: Context,
    decision: "denied" | "expired",
  ): Promise<void>;
  replaySafe?(args: TArgs): boolean;
}

type GatedRegistration = ToolRegistration & { readonly gate?: GateHooks<unknown> };

export function gateHooksOf(tool: ToolRegistration): GateHooks<unknown> | undefined {
  return (tool as GatedRegistration).gate;
}

export async function gateApproved(api: ToolExecutionApi, context: Context): Promise<boolean> {
  return (await api.memo<boolean>("gate:approved", context)) ?? false;
}

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

export function approvalWaitInfo(tool: string, plan: GatePlan | undefined): WaitInfo {
  const vault = plan?.details?.vault as { grantable?: unknown } | undefined;
  return {
    tool,
    ...vaultSubject(plan),
    ...(vault ? { vault: { grantable: vault.grantable === true } } : {}),
  };
}

export async function waitForApproval(
  api: ToolExecutionApi,
  tracker: WaitTracker,
  tool: string,
  context: Context,
  plan?: GatePlan,
): Promise<ApprovalDecision | "expired" | ToolPark> {
  const doc = await parkForOwner(
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
      value.asked = true;
      if (plan?.details?.vault) value.vault = true;
      if (plan?.grant && value.grant === undefined) value.grant = plan.grant;
      if (plan?.expiresInMs && value.expiresAt === undefined) {
        value.expiresAt = Date.now() + plan.expiresInMs;
      }
    },
    approvalWaitInfo(tool, plan),
  );
  if (isParked(doc)) return doc;
  return doc.status as ApprovalDecision | "expired";
}
