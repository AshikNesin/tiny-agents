import { and, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import type { Capabilities } from "@tiny-agents/code/contracts";
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
  waitingCall: () => Promise<{ vault?: unknown } | undefined>,
): Promise<void> {
  if (viewer?.kind !== "guest") return;
  if (input.alwaysAllow || input.grant) throw Boom.forbidden("Only the owner can do that");
  const call = await waitingCall();
  if (call?.vault) throw Boom.forbidden("Only the owner can approve vault use");
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

export function codeCapabilities(viewer: Viewer, caps: Capabilities): Capabilities {
  if (viewer.kind === "owner") return caps;
  return {
    ...caps,
    threads: { ...caps.threads, changeCwd: false },
    settings: {
      ...caps.settings,
      permissionModes: caps.settings.permissionModes.filter((m) => m !== "bypassPermissions"),
    },
    workspace: {
      ...caps.workspace,
      findFiles: false,
      uploads: false,
      browse: false,
      worktrees: false,
    },
  };
}

export function requireCodeChange(
  viewer: Viewer,
  change: { cwd?: string | null; permissionMode?: string | null; projectId?: string | null },
): void {
  if (viewer.kind === "owner") return;
  if (change.projectId) throw Boom.forbidden("Only the owner can start a thread in a project.");
  if (change.permissionMode === "bypassPermissions") {
    throw Boom.forbidden("Only the owner can turn off permission prompts.");
  }
  if (change.cwd) throw Boom.forbidden("Only the owner can choose a working directory.");
}

export function requireCodeAsset(viewer: Viewer, ref: string): void {
  if (viewer.kind === "guest" && !ref.startsWith("img:")) {
    throw Boom.forbidden("Only the owner can open files from the harness host.");
  }
}
