/**
 * Live access: everything a person holds open past the request that let
 * them in. An SSE stream, a desktop viewer's socket and a viewer ticket not
 * yet redeemed were each checked once, when they opened; the guard never
 * sees them again. Each registers here, and taking access away (removing a
 * guest, unsharing a bot) closes what it covers at once.
 */

/** What a live connection was opened under: a person, and the bot it shows (none for app-wide feeds). */
export interface LiveGrant {
  userId: number;
  botId?: string;
}

interface Held {
  grant: LiveGrant;
  close(): void;
}

const held = new Set<Held>();

/**
 * Register a live connection under `grant`; `close` ends it when the grant
 * is revoked. Returns the release, to call when it ends on its own.
 */
export function holdLiveAccess(grant: LiveGrant, close: () => void): () => void {
  const entry: Held = { grant, close };
  held.add(entry);
  return () => held.delete(entry);
}

/** Close every live connection of this person, or, given a bot, only those showing it. */
export function revokeLiveAccess(userId: number, botId?: string): void {
  for (const entry of [...held]) {
    if (entry.grant.userId !== userId) continue;
    if (botId !== undefined && entry.grant.botId !== botId) continue;
    held.delete(entry);
    entry.close();
  }
}
