import { matchPath } from "react-router-dom";
import type { BotListEntry } from "../../shared/api/bots";
import { APP_NAV } from "../components/shell/nav";

const APP_NAME = "tiny-agents";

export interface BotAttention {
  waiting: number;
  replying: boolean;
  unread: boolean;
}

type AttentionFields = Pick<BotListEntry, "approvals" | "questions" | "replying" | "unread">;

export function attentionOf(bot: AttentionFields): BotAttention {
  return { waiting: bot.approvals + bot.questions, replying: bot.replying, unread: bot.unread };
}

export function waitingLabel({
  approvals,
  questions,
}: Pick<BotListEntry, "approvals" | "questions">): string {
  return [
    approvals > 0 ? `${approvals} awaiting approval` : "",
    questions > 0 ? `${questions} ${questions === 1 ? "question" : "questions"} for you` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export function stateLabel(bot: AttentionFields & { name: string }): string {
  const { replying, unread } = attentionOf(bot);
  const state = waitingLabel(bot) || (replying ? "replying" : unread ? "unread" : "");
  return state ? `${bot.name}, ${state}` : bot.name;
}

export function waitingCount(bots: readonly BotListEntry[]): number {
  return bots.reduce((sum, bot) => sum + attentionOf(bot).waiting, 0);
}

export function pageLabel(pathname: string, bots: readonly BotListEntry[]): string | undefined {
  const botId = matchPath("/chats/:botId", pathname)?.params.botId;
  if (botId) return bots.find((bot) => bot.id === botId)?.name;
  if (pathname === "/chats" || pathname === "/") return "Chats";
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "Settings";
  return APP_NAV.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))?.label;
}

export function documentTitle(pathname: string, bots: readonly BotListEntry[]): string {
  const count = waitingCount(bots);
  const label = pageLabel(pathname, bots);
  return `${count > 0 ? `(${count}) ` : ""}${label ? `${label} · ` : ""}${APP_NAME}`;
}

export function railBots(
  bots: readonly BotListEntry[],
  activeId: string | null,
  limit = 8,
): { shown: BotListEntry[]; hiddenWaiting: number } {
  const rank = (bot: BotListEntry) => {
    const { waiting, replying, unread } = attentionOf(bot);
    return waiting > 0
      ? 0
      : replying
        ? 1
        : unread
          ? 2
          : bot.id === activeId
            ? 3
            : bot.pinnedAt
              ? 4
              : 5;
  };
  const relevant = bots
    .map((bot, index) => ({ bot, index, rank: rank(bot) }))
    .filter((entry) => entry.rank < 5)
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  const shown = relevant.slice(0, limit).map((entry) => entry.bot);
  const hiddenWaiting = relevant
    .slice(limit)
    .reduce((sum, { bot }) => sum + attentionOf(bot).waiting, 0);
  return { shown, hiddenWaiting };
}

const FAVICON_BASE = `<rect width="64" height="64" rx="14" fill="#050505"/><path fill="#fcfcfc" d="M23 14h16a12 12 0 0 1 12 12v6a12 12 0 0 1-12 12H29l-11 8v-9.09A12 12 0 0 1 11 32v-6a12 12 0 0 1 12-12z"/><rect x="24" y="22" width="6" height="12" rx="3" fill="#050505"/><rect x="36" y="22" width="6" height="12" rx="3" fill="#050505"/>`;

export const BADGED_FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${FAVICON_BASE}<circle cx="50" cy="14" r="12" fill="#e5484d" stroke="#050505" stroke-width="3"/></svg>`,
)}`;
