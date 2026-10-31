/**
 * A conversation settled: its reply finished and it went idle. Several
 * things follow from that, and this module runs them in one defined order
 * off one subscription to the activity feed, with one shared read of the
 * transcript (taken lazily, only by a step that needs it):
 *
 *   1. answer the Deliveries submitted to it (bots.delivery.ts)
 *   2. resolve the routine runs awaiting it (routines.runs.ts)
 *   3. fold its last reply into the bot list (bots.service.ts recordReply)
 *   4. push a failed or long reply to the owner (notifications.wiring.ts)
 *   5. arm memory capture (memories.capture.ts)
 *
 * Each step is best-effort: a failure is logged and the next step still
 * runs; the conversation's next idle (or the boot sweeps) retries. The
 * module also remembers when each conversation went busy, so a step can
 * tell how long the reply ran.
 */
import { logger } from "@groot/core/logger";
import type { AgentRuntime, ChatState } from "@tiny-agents/agent";

/** The conversation's chat state, read once by whoever reacts to it settling. */
export type ChatRead = () => Promise<ChatState>;

export interface SettledConversation {
  conversationId: number;
  /** Its chat state, read on first call and shared by every later step. */
  chat: ChatRead;
  /** Epoch ms when the reply started (the busy flip); unknown for one that was running at boot. */
  startedAt?: number;
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
  startedAt?: number,
): Promise<void> {
  let read: Promise<ChatState> | undefined;
  const settled: SettledConversation = {
    conversationId,
    chat: () => (read ??= rt.readChat(conversationId)),
    ...(startedAt !== undefined ? { startedAt } : {}),
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
  const starts = new Map<number, number>();
  return rt.onActivity(async (change) => {
    const conversationId = Number(change.conversation);
    if (change.busy) {
      // Waiting for an approval flips busy again mid-run: the start stays.
      if (!starts.has(conversationId)) starts.set(conversationId, Date.now());
      return;
    }
    const startedAt = starts.get(conversationId);
    starts.delete(conversationId);
    await settle(rt, conversationId, steps, startedAt);
  });
}
