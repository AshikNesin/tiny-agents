/**
 * Tool approvals (issue #1 D3/D4).
 *
 * Every capability tool is installed through `gateExtension`, which wraps it
 * in a replay-safe gate:
 *
 * - A conversation's `tiny.permissions` document lists the tools that run
 *   without asking (written by `AgentRuntime.configure`). A conversation
 *   without the document predates permissions and runs everything.
 * - A tool that must ask waits on its task-scoped `tiny.approval` document
 *   (`waitForOwner`, see `waiting.ts`), publishing `{ approval: "pending" }`
 *   details the chat renders the card from, until the host writes a decision
 *   (`AgentRuntime.decideApproval`).
 * - The side effect itself keeps the wrapped tool's replay policy: for a tool
 *   that is not replay-safe, a durable memo records that the effect started, so
 *   a crash during it reports "interrupted" instead of running it twice.
 * - A tool can carry a gate plan (`withGatePlan`, used by vault sinks, issue
 *   #56): decided once per call before anything runs, it may refuse the call,
 *   ask even where the tool is allowed, add to the card, offer a standing
 *   grant for the conversation and let the approval expire.
 * - Every result leaves the gate scrubbed of registered secret values.
 */
import type { Context } from "@earendil-works/chord";
import {
  defineDoc,
  type Extension,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { JsonObject } from "@earendil-works/pi-durable";
import { secretRedactor } from "./redact";
import { waitForOwner, type WaitTracker } from "./waiting";

/** Which tools of the conversation run without asking. */
export const PermissionsDoc = defineDoc<{ allow: string[] }>({
  kind: "tiny.permissions",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ allow: [] }),
  checkpointWhen: () => false,
});

export type ApprovalDecision = "approved" | "denied";

/**
 * One gated tool call's approval, owned by its tool task. `grant` is the
 * standing grant the card offers; `expiresAt` makes it settle as `expired`.
 */
export const ApprovalDoc = defineDoc<{
  status: "pending" | ApprovalDecision | "expired";
  grant?: string;
  expiresAt?: number;
}>({
  kind: "tiny.approval",
  version: 1,
  scope: "task",
  initial: () => ({ status: "pending" }),
  checkpointWhen: () => false,
});

const text = (value: string) => [{ type: "text" as const, text: value }];

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
export function gateExtension(extension: Extension, tracker: WaitTracker): Extension {
  return { ...extension, tools: extension.tools?.map((tool) => gateTool(tool, tracker)) };
}

export function gateTool(tool: ToolRegistration, tracker: WaitTracker): ToolRegistration {
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
      if (ask) {
        const decision = await waitForDecision(api, tracker, tool.name, context, plan);
        if (decision !== "approved") {
          await hooks?.settled?.(args as never, api, context, decision).catch(() => undefined);
          return decision === "expired"
            ? {
                output: text(
                  `Nobody answered the approval for this ${tool.name} call in time, so it did not run. Tell the owner what you needed; do not retry it unless asked.`,
                ),
                isError: true,
                details: { approval: "expired" },
              }
            : {
                output: text(
                  `The owner denied this ${tool.name} call. Do not retry it unless asked.`,
                ),
                isError: true,
                details: { approval: "denied" },
              };
        }
        await api.memo("gate:approved", true, context);
      }
      if (tool.replay !== "safe") {
        if (await api.memo<boolean>("gate:effect", context)) {
          return {
            output: text(
              `Tool ${tool.name} was interrupted by a restart and may have partially run.`,
            ),
            isError: true,
            details: { interrupted: true, ...(ask ? { approval: "approved" } : {}) },
          };
        }
        await api.memo("gate:effect", true, context);
      }
      const result = scrubResult(await tool.execute(args, api, context));
      // The pending card's details must not outlive the decision.
      return ask
        ? { ...result, details: { approval: "approved", result: result.details ?? null } }
        : result;
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

async function mustAsk(name: string, api: ToolExecutionApi, context: Context): Promise<boolean> {
  const permissions = await api.snapshot(PermissionsDoc, api.conversationId, context);
  return permissions !== undefined && !permissions.allow.includes(name);
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
      if (plan?.grant && value.grant === undefined) value.grant = plan.grant;
      if (plan?.expiresInMs && value.expiresAt === undefined) {
        value.expiresAt = Date.now() + plan.expiresInMs;
      }
    },
    { tool, ...vaultSubject(plan) },
  );
  return doc.status as ApprovalDecision | "expired";
}
