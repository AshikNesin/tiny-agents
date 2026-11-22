import { and, eq, inArray } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import type { UploadReach } from "../../../shared/guest-access";
import { db, botGuests, bots, guests, uploads } from "../../db";

export type Viewer = { kind: "owner"; userId: number } | { kind: "guest"; userId: number };

export async function isGuestAccount(userId: number): Promise<boolean> {
  const row = await db.query.guests.findFirst({
    where: eq(guests.userId, userId),
    columns: { userId: true },
  });
  return row !== undefined;
}

export async function resolveViewer(userId: number): Promise<Viewer> {
  return { kind: (await isGuestAccount(userId)) ? "guest" : "owner", userId };
}

export async function canOpenBot(viewer: Viewer, botId: string): Promise<boolean> {
  if (viewer.kind === "owner") return true;
  const row = await db.query.botGuests.findFirst({
    where: and(eq(botGuests.botId, botId), eq(botGuests.userId, viewer.userId)),
    columns: { botId: true },
  });
  return row !== undefined;
}

export async function openableBots(viewer: Viewer, botIds: string[]): Promise<Set<string>> {
  if (viewer.kind === "owner") return new Set(botIds);
  if (botIds.length === 0) return new Set();
  const rows = await db
    .select({ botId: botGuests.botId })
    .from(botGuests)
    .where(and(inArray(botGuests.botId, botIds), eq(botGuests.userId, viewer.userId)));
  return new Set(rows.map((row) => row.botId));
}

export function followsConversation(viewer: Viewer, conversationId: string): boolean {
  if (viewer.kind === "owner") return true;
  const row = db
    .select({ botId: bots.id })
    .from(bots)
    .innerJoin(botGuests, eq(botGuests.botId, bots.id))
    .where(and(eq(bots.conversationId, conversationId), eq(botGuests.userId, viewer.userId)))
    .get();
  return row !== undefined;
}

export async function canReachUpload(
  viewer: Viewer,
  uploadId: string,
  reach: UploadReach,
): Promise<boolean> {
  if (viewer.kind === "owner") return true;
  const row = await db.query.uploads.findFirst({
    where: eq(uploads.id, uploadId),
    columns: { uploadedBy: true, botId: true },
  });
  if (!row) return false;
  if (row.uploadedBy === viewer.userId) return true;
  return (
    reach === "uploadedOrShared" && row.botId !== null && (await canOpenBot(viewer, row.botId))
  );
}

export async function requireAttachable(viewer: Viewer, uploadIds: string[]): Promise<void> {
  for (const uploadId of uploadIds) {
    if (!(await canReachUpload(viewer, uploadId, "uploadedOrShared"))) {
      throw Boom.notFound(`Unknown attachment "${uploadId}"`);
    }
  }
}

export async function requireApprovalAnswer(
  viewer: Viewer | undefined,
  input: { alwaysAllow?: string; grant?: boolean },
  waitingCall: () => Promise<{ vault?: unknown; name?: string } | undefined>,
): Promise<void> {
  if (viewer?.kind !== "guest") return;
  if (input.alwaysAllow || input.grant) throw Boom.forbidden("Only the owner can do that");
  const call = await waitingCall();
  if (call?.vault) throw Boom.forbidden("Only the owner can approve vault use");
  if (call?.name === "save_skill") {
    throw Boom.forbidden("Only the owner can approve saving skills");
  }
}

export function seesConnections(viewer: Viewer): boolean {
  return viewer.kind === "owner";
}

export function countsAsWatching(viewer: Viewer): boolean {
  return viewer.kind === "owner";
}

export function watchOnly(viewer: Viewer): boolean {
  return viewer.kind === "guest";
}
