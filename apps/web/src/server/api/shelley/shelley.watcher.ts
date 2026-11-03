/**
 * Shelley turn ends, acted on (issue #143):
 *
 * - A **hand-off** (a bot started the conversation with `shelley_start`)
 *   gets the finish delivered into the bot's chat, once, as a reply from
 *   Shelley. Shelley's words are untrusted peer text there.
 * - A **followed** conversation (started, opened or handed off here) pushes
 *   a notification when it finishes, fails or messages the owner while no
 *   tab shows it.
 *
 * Nothing polls: the hub reports working → idle from Shelley's stream, and
 * on every (re)connect the running hand-offs are reconciled against Shelley,
 * so a finish missed while the stream was down is still delivered once.
 */
import type { Notification } from "@groot/core/notification/notifier";
import { relayText } from "../bots/bots.delivery";
import { sanitizePeerText } from "@tiny-agents/agent";
import { shelleyUpdate } from "../notifications/notifications.events";
import type { ShelleyFrame, ShelleyHub, TurnEnd } from "./shelley.hub";
import {
  excerpt,
  finishHandoffOnce,
  isFollowed,
  logWatcherError,
  readTurnOutcome,
  runningHandoffs,
  type TurnOutcome,
} from "./shelley.service";
import type { ShelleyHandoff } from "../../db";

export interface WatcherDeps {
  hub: ShelleyHub;
  /** Submit a message into a bot's current chat (idempotent by requestId). */
  deliver(botId: string, submission: { requestId: string; text: string }): Promise<void>;
  notify(notification: Notification): void;
  /** Shelley's view of a conversation now (tests inject). */
  readOutcome?: (conversationId: string) => Promise<TurnOutcome>;
}

/** The chat text a bot receives when its hand-off's turn ends. */
export function handoffFinishText(
  handoff: Pick<ShelleyHandoff, "shelleyConversationId" | "slug">,
  outcome: { text: string; failed: boolean; slug?: string | null },
): string {
  const name = outcome.slug || handoff.slug || handoff.shelleyConversationId;
  const head = outcome.failed
    ? `Shelley stopped with an error in **${name}**.`
    : `Shelley finished **${name}**.`;
  const body = outcome.text ? `\n\n${sanitizePeerText(excerpt(outcome.text))}` : "";
  return relayText(
    "Shelley",
    `${head} [Open in Code](/code/${handoff.shelleyConversationId})${body}`,
  );
}

export function startShelleyWatcher(deps: WatcherDeps): () => void {
  const { hub } = deps;
  const read = deps.readOutcome ?? ((id: string) => readTurnOutcome(id));

  function title(conversationId: string, outcome?: TurnOutcome): string {
    const row = hub.list()?.find((r) => r.conversation_id === conversationId);
    return outcome?.slug || row?.slug || conversationId;
  }

  async function deliverFinished(handoffs: ShelleyHandoff[], outcome: TurnOutcome) {
    for (const handoff of handoffs) {
      if (!(await finishHandoffOnce(handoff.id))) continue;
      await deps.deliver(handoff.botId, {
        requestId: `shelley-${handoff.id}-${outcome.maxSequenceId}`,
        text: handoffFinishText(handoff, outcome),
      });
    }
  }

  async function onTurnEnd(end: TurnEnd) {
    const id = end.conversationId;
    const [handoffs, followed] = await Promise.all([runningHandoffs([id]), isFollowed(id)]);
    if (handoffs.length === 0 && !followed) return;
    const outcome = await read(id);
    // A queued message started the next turn already: wait for that one.
    if (outcome.working) return;
    if (end.finalResponse && !outcome.failed) outcome.text = end.finalResponse;
    await deliverFinished(handoffs, outcome);
    if (followed && hub.viewers(id) === 0) {
      deps.notify(
        shelleyUpdate(
          { id, title: title(id, outcome) },
          outcome.failed ? "failed" : "finished",
          outcome.text,
          outcome.endedAt ?? Date.now(),
        ),
      );
    }
  }

  /** Hand-offs whose turn ended while the stream was down. */
  async function reconcile() {
    const open = await runningHandoffs();
    const byConversation = new Map<string, ShelleyHandoff[]>();
    for (const h of open) {
      byConversation.set(h.shelleyConversationId, [
        ...(byConversation.get(h.shelleyConversationId) ?? []),
        h,
      ]);
    }
    for (const [id, handoffs] of byConversation) {
      try {
        const outcome = await read(id);
        if (outcome.working) continue;
        // Only a turn that ended after the hand-off started counts.
        const ended = outcome.endedAt ?? 0;
        const due = handoffs.filter((h) => ended >= h.createdAt.getTime());
        if (due.length > 0) await deliverFinished(due, outcome);
      } catch (error) {
        logWatcherError(error, id, "reconcile");
      }
    }
  }

  /** `message_user`: Shelley wants the owner's attention mid-turn. */
  async function onFrame(frame: ShelleyFrame) {
    const id = frame.conversation_id;
    if (!id || !frame.messages?.length || hub.viewers(id) > 0) return;
    for (const message of frame.messages) {
      if (message.type !== "agent" || typeof message.llm_data !== "string") continue;
      const text = messageUserText(message.llm_data);
      if (!text || !(await isFollowed(id))) continue;
      deps.notify(shelleyUpdate({ id, title: title(id) }, "message", text, message.sequence_id));
    }
  }

  const offTurn = hub.onTurnEnd((end) => {
    void onTurnEnd(end).catch((error: unknown) =>
      logWatcherError(error, end.conversationId, "turn end"),
    );
  });
  const offConnected = hub.onConnected(() => {
    void reconcile().catch((error: unknown) => logWatcherError(error, "*", "reconcile"));
  });
  const offFrames = hub.subscribe(null, (frame) => {
    void onFrame(frame).catch((error: unknown) =>
      logWatcherError(error, frame.conversation_id ?? "?", "message_user"),
    );
  });
  return () => {
    offTurn();
    offConnected();
    offFrames();
  };
}

/** The `text` of a `message_user` tool call in an agent message's llm_data. */
export function messageUserText(llmData: string): string | undefined {
  try {
    const parsed = JSON.parse(llmData) as {
      Content?: Array<{ Type?: number; ToolName?: string; ToolInput?: { text?: unknown } }>;
    };
    const call = (parsed.Content ?? []).find(
      (c) => c.Type === 5 && c.ToolName === "message_user" && typeof c.ToolInput?.text === "string",
    );
    return call ? String(call.ToolInput?.text) : undefined;
  } catch {
    return undefined;
  }
}
