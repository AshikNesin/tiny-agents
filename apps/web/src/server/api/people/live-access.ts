/**
 * Live access: everything a person holds open past the request that let
 * them in. An SSE stream, a desktop viewer's socket and a viewer ticket not
 * yet redeemed were each checked once, when they opened; the guard never
 * sees them again. Each registers here, and taking access away (removing a
 * guest, unsharing a bot, deleting it) closes what it covers at once.
 *
 * Registration re-checks the grant against the database synchronously, so a
 * revocation that lands between a request's guard and its registration (the
 * route awaited something in between) is still seen: it either committed
 * before the check, which then refuses, or runs after the registration and
 * closes it.
 */
import { and, eq } from "drizzle-orm";
import { db, botGuests, guests, users } from "../../db";

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

/** Whether the grant still holds: the account exists, and a guest's bot is still shared with them. */
function granted({ userId, botId }: LiveGrant): boolean {
  const account = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (!account) return false;
  if (botId === undefined) return true;
  const guest = db
    .select({ userId: guests.userId })
    .from(guests)
    .where(eq(guests.userId, userId))
    .get();
  if (!guest) return true;
  const share = db
    .select({ botId: botGuests.botId })
    .from(botGuests)
    .where(and(eq(botGuests.botId, botId), eq(botGuests.userId, userId)))
    .get();
  return share !== undefined;
}

/**
 * Register a live connection under `grant`; `close` ends it when the grant
 * is revoked, and at once when it no longer holds. Returns the release, to
 * call when it ends on its own.
 */
export function holdLiveAccess(grant: LiveGrant, close: () => void): () => void {
  if (!granted(grant)) {
    close();
    return () => {};
  }
  const entry: Held = { grant, close };
  held.add(entry);
  return () => held.delete(entry);
}

type Revocation = { userId: number; botId?: string } | { botId: string };

/**
 * Close every live connection of this person (given a bot, only those
 * showing it), or, given only a bot, everyone's showing it.
 */
export function revokeLiveAccess(revoked: Revocation): void {
  for (const entry of [...held]) {
    if ("userId" in revoked && entry.grant.userId !== revoked.userId) continue;
    if (revoked.botId !== undefined && entry.grant.botId !== revoked.botId) continue;
    held.delete(entry);
    entry.close();
  }
}
