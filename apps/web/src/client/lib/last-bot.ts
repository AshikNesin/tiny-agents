import { groupBots } from "./bot-groups";
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
  const { pinned, recent } = groupBots(bots);
  return pinned[0]?.id ?? recent[0]?.id ?? null;
}
