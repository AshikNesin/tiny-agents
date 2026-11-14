/**
 * Following a bot's chat (GLOSSARY: Bot stream): everything the chat's
 * stream carries, from every source, in the order the client can rely on.
 *
 * - The transcript: the newest messages (`CHAT_WINDOW`, issue #92) as a
 *   snapshot, then its changes, from the runtime's `watchChat`.
 * - Routine cards (issue #63): the thread's finished runs, then each new one.
 * - YOLO mode (issue #151): its state, then each switch.
 * - The bot moving to another chat ends the follow (`sink.end()`); the client
 *   reconnects onto the new conversation.
 * - While followed, the bot counts as watched (`watchBot`), so a run ending
 *   in a chat the owner has open is not pushed to them.
 *
 * Every part is followed before it is read, so nothing that happens in
 * between is lost, and live card and YOLO events are held until the part's
 * first state is out, so a late read never overwrites a newer event.
 */
import { CHAT_WINDOW, type AgentRuntime } from "@tiny-agents/agent";
import type { BotStreamEvent } from "../../../shared/bot-stream";
import { chatCards } from "../routines/routines.cards";
import { onBotChatEvent } from "./bots.events";
import { getAgentRuntime } from "./bots.runtime";
import { watchBot } from "./bots.viewers";
import { conversationRef, type BotRow } from "./bots.conversation";

/** Where a followed chat goes: an SSE response, or a test's recorder. */
export interface BotChatSink {
  write(event: BotStreamEvent): void;
  /** The bot moved to another chat: this follow is over. */
  end(): void;
}

export type FollowedBot = Pick<BotRow, "id" | "conversationId" | "chatStartedAt">;

export type BotStreamRuntime = Pick<AgentRuntime, "watchChat" | "yolo">;

/**
 * Follow `bot`'s current chat into `sink` until the returned stop is called
 * (or the bot moves to another chat, which also calls `sink.end()`). A
 * failure while starting stops whatever had started and rejects.
 */
export async function followBotChat(
  bot: FollowedBot,
  sink: BotChatSink,
  rt: BotStreamRuntime = getAgentRuntime(),
  options: { watched?: boolean } = {},
): Promise<() => void> {
  const stops: (() => void)[] = [];
  const stop = () => {
    for (const next of stops.splice(0).reverse()) {
      try {
        next();
      } catch {
        // One failing cleanup must not keep the others from running.
      }
    }
  };
  const conversation = conversationRef(bot.conversationId);
  // Card and YOLO events that arrive before their first state is written.
  let held: BotStreamEvent[] | null = [];
  const send = (event: BotStreamEvent) => (held ? held.push(event) : sink.write(event));
  try {
    if (options.watched !== false) stops.push(watchBot(bot.id));
    stops.push(
      onBotChatEvent(bot.id, (event) => {
        if (event.type === "chat-changed") sink.end();
        else send(event);
      }),
    );
    const subscription = await rt.watchChat(
      conversation,
      (events) => {
        for (const event of events) sink.write(event);
      },
      { window: CHAT_WINDOW },
    );
    stops.push(() => void subscription.stop());
    const [runs, yolo] = await Promise.all([
      chatCards(bot.id, bot.chatStartedAt),
      rt.yolo(conversation),
    ]);
    sink.write({ type: "routine-runs", runs });
    sink.write({ type: "yolo", on: yolo });
    const late = held;
    held = null;
    for (const event of late) sink.write(event);
    return stop;
  } catch (error) {
    stop();
    throw error;
  }
}
