/**
 * A conversation settled: its reply finished and it went idle. Several
 * things follow from that, and this module runs them in one defined order
 * off one subscription to the activity feed, with one shared read of the
 * transcript (taken lazily, only by a step that needs it):
 *
 *   1. answer the Deliveries submitted to it (bots.delivery.ts)
 *   2. resolve the routine runs awaiting it (routines.runs.ts)
 *   3. fold its last reply into the bot list (bots.service.ts recordReply)
 *
 * Each step is best-effort: a failure is logged and the next step still
 * runs; the conversation's next idle (or the boot sweeps) retries.
 */
import { logger } from "@groot/core/logger";
import type { AgentRuntime, ChatState } from "@tiny-agents/agent";

/** The conversation's chat state, read once by whoever reacts to it settling. */
export type ChatRead = () => Promise<ChatState>;

export interface SettledConversation {
  conversationId: number;
  /** Its chat state, read on first call and shared by every later step. */
  chat: ChatRead;
}

export interface SettledStep {
  /** For logs. */
  name: string;
  run(settled: SettledConversation): Promise<unknown>;
}

/** Run the steps, in order, for one settled conversation. */
export async function settle(
  rt: Pick<AgentRuntime, "readChat">,
  conversationId: number,
  steps: readonly SettledStep[],
): Promise<void> {
  let read: Promise<ChatState> | undefined;
  const settled: SettledConversation = {
    conversationId,
    chat: () => (read ??= rt.readChat(conversationId)),
  };
  for (const step of steps) {
    try {
      await step.run(settled);
    } catch (error) {
      logger.warn({ error, conversationId, step: step.name }, "A settled-conversation step failed");
    }
  }
}

/** Run the steps on every conversation that goes idle. Returns the unsubscribe. */
export function onConversationSettled(
  rt: Pick<AgentRuntime, "readChat" | "onActivity">,
  steps: readonly SettledStep[],
): () => void {
  return rt.onActivity(async (change) => {
    if (change.busy) return;
    await settle(rt, Number(change.conversation), steps);
  });
}
