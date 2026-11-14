import type { BotListEntry } from "../../shared/api/bots";

/** Recent bots shown before the sidebar folds the rest behind "Show more". */
export const RECENT_FOLD_LIMIT = 8;

export interface BotGroups {
  /** Pinned bots, in the order they were pinned (stable while others reply). */
  pinned: BotListEntry[];
  /** Everything else, most recently active first. */
  recent: BotListEntry[];
}

export function groupBots(bots: BotListEntry[]): BotGroups {
  const pinned = bots
    .filter((bot) => bot.pinnedAt !== null)
    .sort((a, b) => (a.pinnedAt ?? "").localeCompare(b.pinnedAt ?? ""));
  const recent = bots
    .filter((bot) => bot.pinnedAt === null)
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return { pinned, recent };
}

/**
 * The recent rows to render. When folded, only the first `limit` show, but
 * the open bot is always kept visible so the sidebar never hides where you are.
 */
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

/** A bot row's activity time: "now", "5m", "3h", "Yesterday", "Mon", "12 Oct". */
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

/** One line of a message for a list row: markdown markers and line breaks flattened. */
export function previewLine(text: string): string {
  return text
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
