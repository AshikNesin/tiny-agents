import { and, eq } from "drizzle-orm";
import { db, botGuests, guests, users } from "../../db";
import { app } from "../../app-root";

export interface LiveGrant {
  userId: number;
  botId?: string;
  viewOnly?: boolean;
}

export interface HeldLiveAccess {
  grant: LiveGrant;
  close(): void;
}

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

export function holdLiveAccess(grant: LiveGrant, close: () => void): () => void {
  if (!granted(grant)) {
    close();
    return () => {};
  }
  const held = app().liveAccess;
  const entry: HeldLiveAccess = { grant, close };
  held.add(entry);
  return () => held.delete(entry);
}

type Revocation = { userId: number; botId?: string } | { botId: string };

export function revokeLiveAccess(revoked: Revocation): void {
  const held = app().liveAccess;
  for (const entry of [...held]) {
    if ("userId" in revoked && entry.grant.userId !== revoked.userId) continue;
    if (revoked.botId !== undefined && entry.grant.botId !== revoked.botId) continue;
    held.delete(entry);
    entry.close();
  }
}
