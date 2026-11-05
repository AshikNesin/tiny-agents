/**
 * The chat's timeline: transcript messages with the bot's routine run cards
 * (issue #63) merged in by time. Cards are not transcript entries, so they
 * slot in between messages by when the run finished; messages keep their
 * order and their index (the read/unread split counts messages only). The
 * live chat adds its Echoes after everything else (lib/chat-session.ts).
 *
 * Runs that finish back to back (no message between them, same day) fold
 * into one item, so a routine firing every few minutes stays one quiet line.
 */
import { SKIP_REPLY, isSkipReply, type ChatMessage, type RoutineRunCard } from "./chat-types";
import type { OutboxEntry } from "./chat-session";

/**
 * A shared chat's silent reply (issue #145): the bot judged the message was
 * not for it. Hidden, also while it streams in (`[sk…`).
 */
export function isHiddenReply(message: ChatMessage): boolean {
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
      /** Ids of the messages folded into this row (see `isToolRound`), the first one's leading. */
      ids?: string[];
    }
  /** Back-to-back routine runs, oldest first; `at` is the newest one's finish. */
  | { kind: "routine-runs"; runs: RoutineRunCard[]; at: number }
  /** An owner send not yet confirmed (GLOSSARY: Echo); `at` is when it was sent. */
  | { kind: "echo"; echo: OutboxEntry; at: number };

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/**
 * A finished assistant round that only called tools (no text, no
 * reasoning): the agent loop stores one per tool round, so a bot that reads
 * three pages leaves three of them before its answer. The timeline folds a
 * run of them into the assistant message that follows, as the Code page
 * does, so the turn reads as one row: its tool steps, then the reply.
 */
export function isToolRound(message: ChatMessage): boolean {
  return (
    message.role === "assistant" &&
    message.status === "done" &&
    !message.peer &&
    !message.reasoning &&
    message.text.trim().length === 0 &&
    (message.toolCalls?.length ?? 0) > 0
  );
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
  messages.forEach((message, index) => {
    if (isHiddenReply(message)) return;
    while (next < cards.length && cards[next].at < message.createdAt) addRun(cards[next++]);
    const last = items.at(-1);
    if (
      last?.kind === "message" &&
      isToolRound(last.message) &&
      message.role === "assistant" &&
      !message.peer &&
      sameDay(last.at, message.createdAt)
    ) {
      // Keep the first round's id: the row's key stays put as rounds land.
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
