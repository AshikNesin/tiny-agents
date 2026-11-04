/**
 * Approval gate for tools Claude asks for. Claude Code does not run the tool.
 * `off` is an error result, `ask` waits for the owner's decision, `allow`
 * runs the executor once. With `yolo` (issue #151), an `ask` call it
 * accepts runs without waiting.
 */
import type { ToolResultPayload } from "@tiny-agents/claude-worker";

export type ToolPermissionChoice = "allow" | "ask" | "off";

export interface GatedToolCall {
  toolUseId: string;
  name: string;
  input: unknown;
  turnId: string;
}

/** How an `ask` call came to run: the owner's card, or YOLO mode. */
export type ClaudeApproval = "approved" | "yolo";

export interface ClaudeApprovalGate {
  run: (call: GatedToolCall) => Promise<ToolResultPayload>;
  decide: (taskId: number, decision: "approved" | "denied") => void;
  owns: (taskId: number) => boolean;
  /** Calls waiting for the owner, with their tool names. */
  waiting: () => { taskId: number; name: string }[];
}

export function createClaudeApprovalGate(options: {
  permission: (name: string) => ToolPermissionChoice;
  onAsk: (call: GatedToolCall & { taskId: number }) => void;
  execute: (call: GatedToolCall, approval?: ClaudeApproval) => Promise<ToolResultPayload>;
  nextTaskId: () => number;
  /** YOLO mode accepts this `ask` call: it runs without the card. */
  yolo?: (name: string) => boolean;
}): ClaudeApprovalGate {
  const pending = new Map<
    number,
    { name: string; resolve: (decision: "approved" | "denied") => void }
  >();

  return {
    owns: (taskId) => pending.has(taskId),
    waiting: () => [...pending].map(([taskId, { name }]) => ({ taskId, name })),
    decide: (taskId, decision) => {
      const wait = pending.get(taskId);
      if (!wait) throw new Error(`Tool call ${taskId} is not waiting for approval`);
      pending.delete(taskId);
      wait.resolve(decision);
    },
    run: async (call) => {
      const permission = options.permission(call.name);
      if (permission === "off") {
        return { content: `${call.name} is off for this bot.`, isError: true };
      }
      if (permission !== "ask") return options.execute(call);
      if (options.yolo?.(call.name)) return options.execute(call, "yolo");
      const taskId = options.nextTaskId();
      const decision = await new Promise<"approved" | "denied">((resolve) => {
        pending.set(taskId, { name: call.name, resolve });
        options.onAsk({ ...call, taskId });
      });
      if (decision !== "approved") {
        return { content: "The owner denied this.", isError: true };
      }
      return options.execute(call, "approved");
    },
  };
}
