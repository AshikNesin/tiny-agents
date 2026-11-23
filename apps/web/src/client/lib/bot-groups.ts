import type { BotListEntry } from "../../shared/api/bots";

export const RECENT_FOLD_LIMIT = 8;

export interface BotGroups {
  needsYou: BotListEntry[];
  working: BotListEntry[];
  pinned: BotListEntry[];
  recent: BotListEntry[];
}

const newestFirst = (a: BotListEntry, b: BotListEntry) =>
  b.lastActivityAt.localeCompare(a.lastActivityAt);

export function groupBots(bots: BotListEntry[]): BotGroups {
  const needsYou = bots.filter((bot) => bot.approvals + bot.questions > 0).sort(newestFirst);
  const working = bots.filter((bot) => bot.replying && !needsYou.includes(bot)).sort(newestFirst);
  const rest = bots.filter((bot) => !needsYou.includes(bot) && !working.includes(bot));
  const pinned = rest
    .filter((bot) => bot.pinnedAt !== null)
    .sort((a, b) => (a.pinnedAt ?? "").localeCompare(b.pinnedAt ?? ""));
  const recent = rest.filter((bot) => bot.pinnedAt === null).sort(newestFirst);
  return { needsYou, working, pinned, recent };
}

export function visibleRecent(
  recent: BotListEntry[],
  expanded: boolean,
  activeId: string | null,
  limit = RECENT_FOLD_LIMIT,
): BotListEntry[] {
  if (expanded || recent.length <= limit) return recent;
  const head = recent.slice(0, limit);
  const active = activeId ? recent.find((bot) => bot.id === activeId) : undefined;
  return active && !head.includes(active) ? [...head, active] : head;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "";
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const date = new Date(at);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return `${Math.floor(minutes / 60)}h`;
  const yesterday = new Date(now - 24 * 60 * 60_000);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (now - at < 6 * 24 * 60 * 60_000)
    return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function previewLine(text: string): string {
  return text
    .replace(/[*`#>]+/g, "")
    .replace(/(?<![\p{L}\p{N}_])(_{1,2})(?=[^\s_])(.+?)(?<=[^\s_])\1(?![\p{L}\p{N}_])/gu, "$2")
    .replace(/\s+/g, " ")
    .trim();
}
