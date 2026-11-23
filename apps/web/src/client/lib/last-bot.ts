import type { BotListEntry } from "../../shared/api/bots";

const LAST_BOT_KEY = "tiny-agents:last-bot";

export function rememberLastBot(botId: string) {
  try {
    localStorage.setItem(LAST_BOT_KEY, botId);
  } catch {}
}

function readLastBot(): string | null {
  try {
    return localStorage.getItem(LAST_BOT_KEY);
  } catch {
    return null;
  }
}

export function landingBotId(bots: BotListEntry[]): string | null {
  const last = readLastBot();
  if (last && bots.some((bot) => bot.id === last)) return last;
  const pinned = bots
    .filter((bot) => bot.pinnedAt !== null)
    .sort((a, b) => (a.pinnedAt ?? "").localeCompare(b.pinnedAt ?? ""));
  if (pinned[0]) return pinned[0].id;
  const recent = [...bots].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return recent[0]?.id ?? null;
}
