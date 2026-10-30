/**
 * The chat's timeline: transcript messages with the bot's routine run cards
 * (issue #63) merged in by time. Cards are not transcript entries, so they
 * slot in between messages by when the run finished; messages keep their
 * order and their index (the read/unread split counts messages only).
 */
import type { ChatMessage, RoutineRunCard } from "./chat-types";

export type TimelineItem =
  | { kind: "message"; message: ChatMessage; index: number; at: number }
  | { kind: "routine-run"; run: RoutineRunCard; at: number };

export function chatTimeline(
  messages: readonly ChatMessage[],
  runs: readonly RoutineRunCard[],
): TimelineItem[] {
  const cards = runs
    .map((run) => ({ kind: "routine-run" as const, run, at: Date.parse(run.finishedAt) }))
    .sort((a, b) => a.at - b.at);
  const items: TimelineItem[] = [];
  let next = 0;
  messages.forEach((message, index) => {
    while (next < cards.length && cards[next].at < message.createdAt) items.push(cards[next++]);
    items.push({ kind: "message", message, index, at: message.createdAt });
  });
  while (next < cards.length) items.push(cards[next++]);
  return items;
}
