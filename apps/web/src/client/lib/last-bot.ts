import type { BotListEntry } from "../../shared/api/bots";
import { readStored, writeStored } from "./browser-storage";

const LAST_BOT_KEY = "tiny-agents:last-bot";

export function rememberLastBot(botId: string) {
  writeStored(LAST_BOT_KEY, botId);
}

function readLastBot(): string | null {
  return readStored(LAST_BOT_KEY);
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
