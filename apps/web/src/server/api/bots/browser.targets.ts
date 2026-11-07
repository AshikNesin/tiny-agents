/**
 * Which browser a bot uses. By default every bot shares one browser profile
 * (`shared`), so a site the owner signs into once is signed in for all of
 * them; a bot set to its own profile gets a separate browser. Either way the
 * bot drives a tab of its own, keyed by its id, so "New chat" keeps it.
 */
import type { BrowserTarget } from "@tiny-agents/agent/browser";
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

/** The toolkit's resolver: tool calls know their conversation, not their bot. */
export async function browserTargetForConversation(conversationId: number): Promise<BrowserTarget> {
  // A routine's runs drive their bot's browser (issue #63).
  const owner = await conversationOwner(conversationId);
  // A conversation no bot shows any more (retired by "New chat") still
  // gets the shared browser, in a tab of its own.
  return owner
    ? browserTargetForBot(owner.bot)
    : { profile: SHARED_BROWSER_PROFILE, tab: `conversation-${conversationId}` };
}
