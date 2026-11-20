import type { ChatMessage } from "./chat-types";

function order(id: string): number {
  const match = /^e(\d+)$/.exec(id);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

export function mergeSnapshot(
  previous: { messages: ChatMessage[]; hasMore?: boolean },
  snapshot: { messages: ChatMessage[]; hasMore?: boolean },
): { messages: ChatMessage[]; hasMore: boolean } {
  const first = snapshot.messages[0];
  if (!snapshot.hasMore || !first) {
    return { messages: snapshot.messages, hasMore: Boolean(snapshot.hasMore) };
  }
  const older = previous.messages.filter((m) => order(m.id) < order(first.id));
  if (older.length === 0) return { messages: snapshot.messages, hasMore: true };
  return { messages: [...older, ...snapshot.messages], hasMore: previous.hasMore ?? true };
}

export function prependOlder(
  messages: ChatMessage[],
  page: { messages: ChatMessage[]; hasMore: boolean },
): { messages: ChatMessage[]; hasMore: boolean } {
  const loaded = new Set(messages.map((m) => m.id));
  return {
    messages: [...page.messages.filter((m) => !loaded.has(m.id)), ...messages],
    hasMore: page.hasMore,
  };
}

export function oldestEntryId(messages: ChatMessage[]): string | undefined {
  return messages.find((m) => /^e\d+$/.test(m.id))?.id;
}
