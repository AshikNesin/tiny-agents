import type { BotListEntry } from "./bots-api";

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
