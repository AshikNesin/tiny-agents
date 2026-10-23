/**
 * Where `/chats` lands on desktop: the bot opened last in this browser, else
 * the bot at the top of the sidebar. Storage can be unavailable (private
 * mode, blocked site data), so every access is best-effort.
 */
import { groupBots } from "./bot-groups";
import type { BotListEntry } from "./bots-api";

const LAST_BOT_KEY = "tiny-agents:last-bot";

export function rememberLastBot(botId: string) {
  try {
    localStorage.setItem(LAST_BOT_KEY, botId);
  } catch {
    // A convenience; without it /chats falls back to the sidebar's top bot.
  }
}

function readLastBot(): string | null {
  try {
    return localStorage.getItem(LAST_BOT_KEY);
  } catch {
    return null;
  }
}

/** The last-opened bot if it still exists, else the sidebar's first row. */
export function landingBotId(bots: BotListEntry[]): string | null {
  const last = readLastBot();
  if (last && bots.some((bot) => bot.id === last)) return last;
  const { pinned, recent } = groupBots(bots);
  return pinned[0]?.id ?? recent[0]?.id ?? null;
}
