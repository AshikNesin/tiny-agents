/**
 * Approval gate for tools Claude asks for. Claude Code does not run the tool.
 * `off` is an error result, `ask` waits for the owner's decision, `allow`
 * runs the executor once.
 */
import type { ToolResultPayload } from "@tiny-agents/claude-worker";

export type ToolPermissionChoice = "allow" | "ask" | "off";

export interface GatedToolCall {
  toolUseId: string;
  name: string;
  input: unknown;
  turnId: string;
}

export interface ClaudeApprovalGate {
  run: (call: GatedToolCall) => Promise<ToolResultPayload>;
  decide: (taskId: number, decision: "approved" | "denied") => void;
  owns: (taskId: number) => boolean;
}

export function createClaudeApprovalGate(options: {
  permission: (name: string) => ToolPermissionChoice;
  onAsk: (call: GatedToolCall & { taskId: number }) => void;
  execute: (call: GatedToolCall) => Promise<ToolResultPayload>;
  nextTaskId: () => number;
}): ClaudeApprovalGate {
  const pending = new Map<number, (decision: "approved" | "denied") => void>();

  return {
    owns: (taskId) => pending.has(taskId),
    decide: (taskId, decision) => {
      const resolve = pending.get(taskId);
      if (!resolve) throw new Error(`Tool call ${taskId} is not waiting for approval`);
      pending.delete(taskId);
      resolve(decision);
    },
    run: async (call) => {
      const permission = options.permission(call.name);
      if (permission === "off") {
        return { content: `${call.name} is off for this bot.`, isError: true };
      }
      if (permission === "ask") {
        const taskId = options.nextTaskId();
        const decision = await new Promise<"approved" | "denied">((resolve) => {
          pending.set(taskId, resolve);
          options.onAsk({ ...call, taskId });
        });
        if (decision !== "approved") {
          return { content: "The owner denied this.", isError: true };
        }
      }
      return options.execute(call);
    },
  };
}
