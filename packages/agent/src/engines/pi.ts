import type { Extension, ToolRegistration } from "@earendil-works/pi-durable";
import type { Harness } from "@earendil-works/pi-durable";
import { gateHooksOf } from "../approvals";
import type { AgentEngine } from "../engine";
import type { ToolGate } from "../gate";
import type { GateUserMessage } from "../policy";

/**
 * The pi-durable harness as an engine. Owning the harness here is the seam
 * the Claude Code engine sits beside. Every call still goes to the same
 * harness methods the runtime used directly.
 */
export class PiEngine implements AgentEngine {
  readonly kind = "pi" as const;

  constructor(readonly harness: Harness) {}
}

/**
 * pi's adapter onto the Tool gate: every tool of the extension runs through
 * it, with its answers kept in task documents (a restart re-attaches).
 * `userMessages` reads the conversation's newest user messages.
 */
export function gateExtension(
  extension: Extension,
  gate: ToolGate,
  userMessages: (conversation: number) => Promise<readonly GateUserMessage[]>,
): Extension {
  return {
    ...extension,
    tools: extension.tools?.map((tool) => gateTool(tool, gate, userMessages)),
  };
}

function gateTool(
  tool: ToolRegistration,
  gate: ToolGate,
  userMessages: (conversation: number) => Promise<readonly GateUserMessage[]>,
): ToolRegistration {
  const hooks = gateHooksOf(tool);
  return {
    ...tool,
    // The gate itself is replay-safe: its decisions are memoized, and an
    // unsafe tool's effect is guarded by its own memo.
    replay: "safe",
    execute: (args, api, context) =>
      gate.run(
        {
          name: tool.name,
          args,
          replaySafe: tool.replay === "safe",
          hooks,
          api,
          context,
          answers: "document",
          userMessages: () => userMessages(Number(api.conversationId)),
          instructions: async () => (await api.agent(context)).instructions,
        },
        () => tool.execute(args, api, context),
      ),
  };
}
