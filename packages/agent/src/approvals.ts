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
 */
import type { Context } from "@earendil-works/chord";
import {
  defineDoc,
  type Extension,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
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

/** One gated tool call's approval, owned by its tool task. */
export const ApprovalDoc = defineDoc<{ status: "pending" | ApprovalDecision }>({
  kind: "tiny.approval",
  version: 1,
  scope: "task",
  initial: () => ({ status: "pending" }),
  checkpointWhen: () => false,
});

const text = (value: string) => [{ type: "text" as const, text: value }];

/** Wrap every tool of an extension in the approval gate. */
export function gateExtension(extension: Extension, tracker: WaitTracker): Extension {
  return { ...extension, tools: extension.tools?.map((tool) => gateTool(tool, tracker)) };
}

export function gateTool(tool: ToolRegistration, tracker: WaitTracker): ToolRegistration {
  return {
    ...tool,
    replay: "safe",
    async execute(args, api, context): Promise<ToolExecutionResult> {
      // Decided once per call, so a permission change mid-call can't flip it on replay.
      const ask = await api.memo("gate:ask", await mustAsk(tool.name, api, context), context);
      if (ask) {
        const decision = await waitForDecision(api, tracker, context);
        if (decision === "denied") {
          return {
            output: text(`The owner denied this ${tool.name} call. Do not retry it unless asked.`),
            isError: true,
            details: { approval: "denied" },
          };
        }
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
      const result = await tool.execute(args, api, context);
      // The pending card's details must not outlive the decision.
      return ask
        ? { ...result, details: { approval: "approved", result: result.details ?? null } }
        : result;
    },
  };
}

async function mustAsk(name: string, api: ToolExecutionApi, context: Context): Promise<boolean> {
  const permissions = await api.snapshot(PermissionsDoc, api.conversationId, context);
  return permissions !== undefined && !permissions.allow.includes(name);
}

async function waitForDecision(
  api: ToolExecutionApi,
  tracker: WaitTracker,
  context: Context,
): Promise<ApprovalDecision> {
  const doc = await waitForOwner(api, tracker, ApprovalDoc, { approval: "pending" }, context);
  return doc.status as ApprovalDecision;
}
