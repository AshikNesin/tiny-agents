import { SKIP_REPLY, isSkipReply, type ChatMessage, type RoutineRunCard } from "./chat-types";
import type { OutboxEntry } from "./chat-session";

function isHiddenReply(message: ChatMessage): boolean {
  if (isSkipReply(message)) return true;
  const text = message.text.trim();
  return (
    message.role === "assistant" &&
    message.status === "streaming" &&
    text.length > 0 &&
    SKIP_REPLY.startsWith(text) &&
    (message.toolCalls?.length ?? 0) === 0
  );
}

export type TimelineItem =
  | {
      kind: "message";
      message: ChatMessage;
      index: number;
      at: number;
      ids?: string[];
    }
  | { kind: "routine-runs"; runs: RoutineRunCard[]; at: number }
  | { kind: "echo"; echo: OutboxEntry; at: number };

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

function isToolRound(message: ChatMessage): boolean {
  return (
    message.role === "assistant" &&
    message.status === "done" &&
    !message.peer &&
    !message.reasoning &&
    message.text.trim().length === 0 &&
    (message.toolCalls?.length ?? 0) > 0
  );
}

function presentQuiet(message: ChatMessage): ChatMessage {
  if (!message.quiet) return message;
  const reasoning = [message.reasoning, message.text].filter(Boolean).join("\n\n");
  const { reasoning: _reasoning, ...rest } = message;
  return {
    ...rest,
    text: (message.sent ?? []).join("\n\n"),
    ...(reasoning ? { reasoning } : {}),
  };
}

export function chatTimeline(
  messages: readonly ChatMessage[],
  runs: readonly RoutineRunCard[],
): TimelineItem[] {
  const cards = runs
    .map((run) => ({ run, at: Date.parse(run.finishedAt) }))
    .sort((a, b) => a.at - b.at);
  const items: TimelineItem[] = [];
  const addRun = (card: (typeof cards)[number]) => {
    const last = items.at(-1);
    if (last?.kind === "routine-runs" && sameDay(last.at, card.at)) {
      last.runs.push(card.run);
      last.at = card.at;
    } else {
      items.push({ kind: "routine-runs", runs: [card.run], at: card.at });
    }
  };
  let next = 0;
  messages.forEach((original, index) => {
    if (isHiddenReply(original)) return;
    const message = presentQuiet(original);
    while (next < cards.length && cards[next].at < message.createdAt) addRun(cards[next++]);
    const last = items.at(-1);
    if (
      last?.kind === "message" &&
      isToolRound(last.message) &&
      message.role === "assistant" &&
      !message.peer &&
      sameDay(last.at, message.createdAt)
    ) {
      last.message = {
        ...message,
        id: last.message.id,
        toolCalls: [...(last.message.toolCalls ?? []), ...(message.toolCalls ?? [])],
      };
      last.ids = [...(last.ids ?? [last.message.id]), message.id];
      last.index = index;
      last.at = message.createdAt;
      return;
    }
    items.push({ kind: "message", message, index, at: message.createdAt });
  });
  while (next < cards.length) addRun(cards[next++]);
  return items;
}
