/**
 * One bus per bot for what happens to its chat beside the transcript: the
 * bot moving to another conversation ("New chat", continuing a Past chat),
 * YOLO mode switching, a routine run finishing in the chat's thread. The
 * modules that make these happen publish here; the bot's chat streams
 * (`followBotChat`, bots.stream.ts) listen. The transcript itself streams
 * from the runtime (`watchChat`), not through this bus.
 */
import { logger } from "@groot/core/logger";
import type { RoutineRunCard } from "../../../shared/bot-stream";

export type BotChatEvent =
  /** The bot's row names another conversation now: its chat streams end and reopen there. */
  | { type: "chat-changed" }
  /** The owner switched YOLO mode in the bot's current chat (issue #151). */
  | { type: "yolo"; on: boolean }
  /** One of the bot's routines finished a run (issue #63). */
  | { type: "routine-run"; run: RoutineRunCard };

type Listener = (event: BotChatEvent) => void;

const listeners = new Map<string, Set<Listener>>();

/** Follow one bot's chat events. Returns the unsubscribe. */
export function onBotChatEvent(botId: string, listener: Listener): () => void {
  let set = listeners.get(botId);
  if (!set) listeners.set(botId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0 && listeners.get(botId) === set) listeners.delete(botId);
  };
}

/** Tell the bot's followers. A failing listener is logged; the others still hear it. */
export function publishBotChatEvent(botId: string, event: BotChatEvent): void {
  // A copy: a listener may unsubscribe (or subscribe another) while it runs.
  for (const listener of Array.from(listeners.get(botId) ?? [])) {
    try {
      listener(event);
    } catch (error) {
      logger.warn({ error, botId, event: event.type }, "A bot chat listener failed");
    }
  }
}
