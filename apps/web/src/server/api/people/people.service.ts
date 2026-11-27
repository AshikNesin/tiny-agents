import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import * as authService from "@groot/core/auth/auth.service";
import type { CreateUserDTO } from "@groot/core/auth/auth.schema";
import { hashPassword } from "@groot/core/utils/password.utils";
import { db, botGuests, guests, users } from "../../db";
import { isGuestAccount } from "./access";
import { revokeLiveAccess } from "./live-access";
import type { GuestData, GuestRemoved } from "../../../shared/api/people";

function displayName(user: { name: string | null; email: string }): string {
  return user.name?.trim() || user.email.split("@")[0] || user.email;
}

export async function listGuests(): Promise<GuestData[]> {
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

export async function addGuest(data: CreateUserDTO): Promise<GuestData> {
  const taken = () => Boom.conflict("User with this email already exists");
  if (await authService.findUserByEmail(data.email)) throw taken();
  const password = await hashPassword(data.password);
  const user = db.transaction((tx) => {
    if (tx.select({ id: users.id }).from(users).where(eq(users.email, data.email)).get()) {
      throw taken();
    }
    const created = tx
      .insert(users)
      .values({ email: data.email, password, name: data.name })
      .returning({ id: users.id, email: users.email, name: users.name })
      .get();
    tx.insert(guests).values({ userId: created.id }).run();
    return created;
  });
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    createdAt: new Date(),
    botIds: [],
  };
}

export async function removeGuest(userId: number): Promise<GuestRemoved> {
  if (!(await isGuestAccount(userId))) throw Boom.notFound("Guest not found");
  await db.delete(users).where(eq(users.id, userId));
  revokeLiveAccess({ userId });
  return { removed: true };
}

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

export async function markGuestRead(botId: string, userId: number): Promise<void> {
  await db
    .update(botGuests)
    .set({ lastReadAt: new Date() })
    .where(and(eq(botGuests.botId, botId), eq(botGuests.userId, userId)));
}

export async function guestReadMarkers(userId: number): Promise<Map<string, Date | null>> {
  const rows = await db
    .select({ botId: botGuests.botId, lastReadAt: botGuests.lastReadAt })
    .from(botGuests)
    .where(eq(botGuests.userId, userId));
  return new Map(rows.map((row) => [row.botId, row.lastReadAt]));
}

export async function authorOf(userId: number): Promise<{ id: number; name: string }> {
  const user = await authService.findUserById(userId);
  return { id: userId, name: user ? displayName(user) : `User ${userId}` };
}

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

export async function ownerDisplayName(): Promise<string | undefined> {
  return (await ownerRow())?.name?.trim() || undefined;
}

export async function ownerUserId(): Promise<number | undefined> {
  return (await ownerRow())?.id;
}
