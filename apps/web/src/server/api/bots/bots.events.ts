import { logger } from "@groot/core/logger";
import type { RoutineRunCard } from "../../../shared/bot-stream";
import { app } from "../../app-root";

export type BotChatEvent =
  | { type: "chat-changed" }
  | { type: "yolo"; on: boolean }
  | { type: "routine-run"; run: RoutineRunCard };

type Listener = (event: BotChatEvent) => void;

export function onBotChatEvent(botId: string, listener: Listener): () => void {
  const listeners = app().botChatListeners;
  let set = listeners.get(botId);
  if (!set) listeners.set(botId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0 && listeners.get(botId) === set) listeners.delete(botId);
  };
}

export function publishBotChatEvent(botId: string, event: BotChatEvent): void {
  for (const listener of Array.from(app().botChatListeners.get(botId) ?? [])) {
    try {
      listener(event);
    } catch (error) {
      logger.warn({ error, botId, event: event.type }, "A bot chat listener failed");
    }
  }
}
