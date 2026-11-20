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

export function pastChatTitle(chat: Pick<PastChat, "title" | "startedAt">, now = Date.now()) {
  return chat.title?.trim() || `Chat from ${day(chat.startedAt, now)}`;
}

export function pastChatRange(chat: Pick<PastChat, "startedAt" | "endedAt">, now = Date.now()) {
  const start = day(chat.startedAt, now);
  const end = day(chat.endedAt, now);
  return start === end ? start : `${start} – ${end}`;
}

export function messageCountLabel(count: number): string {
  return `${count} ${count === 1 ? "message" : "messages"}`;
}
