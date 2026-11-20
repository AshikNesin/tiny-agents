import { CHAT_WINDOW, type AgentRuntime } from "@tiny-agents/agent";
import type { BotStreamEvent } from "../../../shared/bot-stream";
import { chatCards } from "../routines/routines.cards";
import { onBotChatEvent } from "./bots.events";
import { getAgentRuntime } from "./bots.runtime";
import { watchBot } from "./bots.viewers";
import { conversationRef, type BotRow } from "./bots.conversation";

export interface BotChatSink {
  write(event: BotStreamEvent): void;
  end(): void;
}

export type FollowedBot = Pick<BotRow, "id" | "conversationId" | "chatStartedAt">;

export type BotStreamRuntime = Pick<AgentRuntime, "watchChat" | "yolo">;

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
      } catch {}
    }
  };
  const conversation = conversationRef(bot.conversationId);
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
