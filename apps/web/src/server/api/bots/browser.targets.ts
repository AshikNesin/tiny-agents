import type { BrowserTarget } from "@tiny-agents/sandbox/browser";
import { conversationOwner } from "./bots.owner";

export const SHARED_BROWSER_PROFILE = "shared";

export function ownBrowserProfile(botId: string): string {
  return `bot-${botId}`;
}

export function browserTargetForBot(bot: { id: string; browserProfile: string }): BrowserTarget {
  return {
    profile: bot.browserProfile === "own" ? ownBrowserProfile(bot.id) : SHARED_BROWSER_PROFILE,
    tab: bot.id,
  };
}

export async function browserTargetForConversation(conversationId: number): Promise<BrowserTarget> {
  const owner = await conversationOwner(conversationId);
  return owner
    ? browserTargetForBot(owner.bot)
    : { profile: SHARED_BROWSER_PROFILE, tab: `conversation-${conversationId}` };
}
