/**
 * Past chats (issue #101): how the history list and the past-chat view name
 * and date a chat.
 */
import type { PastChat } from "../../shared/api/bots";

function day(iso: string, now: number): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** The title, else "Chat from Oct 12" (a chat whose title never arrived). */
export function pastChatTitle(chat: Pick<PastChat, "title" | "startedAt">, now = Date.now()) {
  return chat.title?.trim() || `Chat from ${day(chat.startedAt, now)}`;
}

/** "Oct 12 – Oct 20", or just "Oct 12" for a chat that began and ended the same day. */
export function pastChatRange(chat: Pick<PastChat, "startedAt" | "endedAt">, now = Date.now()) {
  const start = day(chat.startedAt, now);
  const end = day(chat.endedAt, now);
  return start === end ? start : `${start} – ${end}`;
}

/** "1 message" / "34 messages". */
export function messageCountLabel(count: number): string {
  return `${count} ${count === 1 ? "message" : "messages"}`;
}
