/**
 * Guests and shared bots (issue #145). The owner adds a guest (a plain
 * account plus a `guests` row) and shares bots with them: a shared bot's chat
 * is one conversation everybody in it sees live. What a guest may reach is
 * the access module's (`access.ts`, `guest.guard.ts`); an account with no
 * `guests` row is the owner, so nothing changes until someone is added.
 */
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import * as authService from "@groot/core/auth/auth.service";
import type { CreateUserDTO } from "@groot/core/auth/auth.schema";
import { db, botGuests, guests, users } from "../../db";
import { isGuestAccount } from "./access";
import { revokeLiveAccess } from "./live-access";

export interface GuestEntry {
  id: number;
  email: string;
  name: string | null;
  createdAt: Date;
  /** Bots shared with this guest. */
  botIds: string[];
}

/** The name a person goes by in a shared chat: their name, else their email's local part. */
function displayName(user: { name: string | null; email: string }): string {
  return user.name?.trim() || user.email.split("@")[0] || user.email;
}

export async function listGuests(): Promise<GuestEntry[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: guests.createdAt,
    })
    .from(guests)
    .innerJoin(users, eq(users.id, guests.userId))
    .orderBy(asc(guests.createdAt));
  const shares = rows.length
    ? await db
        .select({ botId: botGuests.botId, userId: botGuests.userId })
        .from(botGuests)
        .where(
          inArray(
            botGuests.userId,
            rows.map((row) => row.id),
          ),
        )
    : [];
  return rows.map((row) => ({
    ...row,
    botIds: shares.filter((share) => share.userId === row.id).map((share) => share.botId),
  }));
}

/** Add a guest: a new account the owner hands its password to. 409 for a taken email. */
export async function addGuest(data: CreateUserDTO): Promise<GuestEntry> {
  const user = await authService.createUser(data);
  await db.insert(guests).values({ userId: user.id });
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    createdAt: new Date(),
    botIds: [],
  };
}

/**
 * Remove a guest's account (their shares and passkeys go with it), and end
 * what they hold open. Owners are never removed here.
 */
export async function removeGuest(userId: number): Promise<{ removed: true }> {
  if (!(await isGuestAccount(userId))) throw Boom.notFound("Guest not found");
  await db.delete(users).where(eq(users.id, userId));
  revokeLiveAccess({ userId });
  return { removed: true };
}

/**
 * Share a bot with exactly these guests. Unknown ids and owners are refused
 * (400), so a typo never shares with the wrong person. Kept guests keep their
 * read marker; a dropped guest's open views of the bot end.
 */
export async function setBotGuests(botId: string, userIds: number[]): Promise<void> {
  const wanted = [...new Set(userIds)];
  if (wanted.length > 0) {
    const known = await db
      .select({ userId: guests.userId })
      .from(guests)
      .where(inArray(guests.userId, wanted));
    if (known.length !== wanted.length) throw Boom.badRequest("Unknown guest");
  }
  const dropped = db.transaction((tx) => {
    const removed = tx
      .delete(botGuests)
      .where(
        wanted.length > 0
          ? and(eq(botGuests.botId, botId), notInArray(botGuests.userId, wanted))
          : eq(botGuests.botId, botId),
      )
      .returning({ userId: botGuests.userId })
      .all();
    if (wanted.length > 0) {
      tx.insert(botGuests)
        .values(wanted.map((userId) => ({ botId, userId })))
        .onConflictDoNothing()
        .run();
    }
    return removed;
  });
  for (const { userId } of dropped) revokeLiveAccess({ userId, botId });
}

/** A guest's read marker on a shared bot. */
export async function markGuestRead(botId: string, userId: number): Promise<void> {
  await db
    .update(botGuests)
    .set({ lastReadAt: new Date() })
    .where(and(eq(botGuests.botId, botId), eq(botGuests.userId, userId)));
}

/** Read markers of a guest's shared bots, by bot id. */
export async function guestReadMarkers(userId: number): Promise<Map<string, Date | null>> {
  const rows = await db
    .select({ botId: botGuests.botId, lastReadAt: botGuests.lastReadAt })
    .from(botGuests)
    .where(eq(botGuests.userId, userId));
  return new Map(rows.map((row) => [row.botId, row.lastReadAt]));
}

/** The sender of a message in a shared chat. */
export async function authorOf(userId: number): Promise<{ id: number; name: string }> {
  const user = await authService.findUserById(userId);
  return { id: userId, name: user ? displayName(user) : `User ${userId}` };
}

/**
 * Names of everyone in a shared bot's chat, the owner first; empty when the
 * bot is not shared. The owner is the first account without a `guests` row.
 */
export async function participantNames(botId: string): Promise<string[]> {
  const shared = await db.query.botGuests.findMany({
    where: eq(botGuests.botId, botId),
    with: { user: { columns: { name: true, email: true } } },
    orderBy: (row, { asc }) => [asc(row.createdAt)],
  });
  if (shared.length === 0) return [];
  const owner = await ownerRow();
  return [...(owner ? [displayName(owner)] : []), ...shared.map((row) => displayName(row.user))];
}

/** The owner's account: the first one without a `guests` row. */
async function ownerRow() {
  const guestIds = db.select({ userId: guests.userId }).from(guests);
  const [owner] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(notInArray(users.id, guestIds))
    .orderBy(asc(users.id))
    .limit(1);
  return owner;
}

/** The owner's user id, or undefined before anyone signed up. */
export async function ownerUserId(): Promise<number | undefined> {
  return (await ownerRow())?.id;
}
