/**
 * Paging through a long chat (issue #92). A stream's snapshot carries only
 * the newest messages (`hasMore` when older ones exist); older pages load on
 * scroll. These keep the two consistent.
 */
import type { ChatMessage } from "./chat-types";

/** Transcript order of an entry id ("e42"); live and marker ids sort last. */
function order(id: string): number {
  const match = /^e(\d+)$/.exec(id);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

/**
 * A reconnect's snapshot is the newest window again; keep the older pages
 * already loaded above it. Only a windowed snapshot (`hasMore`) has anything
 * above it: one that starts at the beginning (a short chat, a fresh one after
 * "New chat") replaces everything.
 */
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
  // The older pages reach further back; whether even more exist is theirs to say.
  return { messages: [...older, ...snapshot.messages], hasMore: previous.hasMore ?? true };
}

/** Put a page of older messages above the loaded ones, skipping any already there. */
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

/** The id to page back from: the oldest loaded transcript entry. */
export function oldestEntryId(messages: ChatMessage[]): string | undefined {
  return messages.find((m) => /^e\d+$/.test(m.id))?.id;
}
