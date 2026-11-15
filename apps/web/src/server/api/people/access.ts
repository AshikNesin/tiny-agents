/**
 * Access (docs/rewrite/README.md §4.4 `access`): who is asking, and what
 * they may do. The guard (`guest.guard.ts`) resolves the request's `Viewer`
 * once and refuses a guest anything `GUEST_ACCESS` does not list, any bot
 * not shared with them and any upload they do not reach. Every finer check a
 * route or service makes past the guard is one function here, named after
 * the action, with its status and text. Live access (`live-access.ts`) and
 * People (`people.service.ts`) sit beside it.
 *
 * Shares are read at each check, never snapshotted into the `Viewer`: an
 * events stream outlives the request that opened it, and filters by the
 * shares as they are at each event.
 */
import { and, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import type { Capabilities } from "@tiny-agents/code/contracts";
import type { UploadReach } from "../../../shared/guest-access";
import { db, botGuests, bots, guests, uploads } from "../../db";

/** Who is asking, resolved once per request by the guard. */
export type Viewer = { kind: "owner"; userId: number } | { kind: "guest"; userId: number };

/** Whether the account is a guest: it has a `guests` row. Any other account is the owner (S8). */
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

/** Whether this viewer may open the bot: the owner always, a guest when it is shared with them. */
export async function canOpenBot(viewer: Viewer, botId: string): Promise<boolean> {
  if (viewer.kind === "owner") return true;
  const row = await db.query.botGuests.findFirst({
    where: and(eq(botGuests.botId, botId), eq(botGuests.userId, viewer.userId)),
    columns: { botId: true },
  });
  return row !== undefined;
}

/**
 * Whether this viewer follows a conversation's live activity: the owner every
 * one, a guest the chat of a bot shared with them. Synchronous, for the
 * events stream's filter.
 */
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

/**
 * Whether this viewer may use an upload: the owner always, a guest when they
 * uploaded it or, for "uploadedOrShared", it was sent in a bot shared with them.
 */
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

/** Sending in a chat: 404 for the first attachment, in order, the viewer does not reach. */
export async function requireAttachable(viewer: Viewer, uploadIds: string[]): Promise<void> {
  for (const uploadId of uploadIds) {
    if (!(await canReachUpload(viewer, uploadId, "uploadedOrShared"))) {
      throw Boom.notFound(`Unknown attachment "${uploadId}"`);
    }
  }
}

/**
 * Answering an approval card. A guest answers the bot's approvals, but the
 * vault holds the owner's secrets and "always allow" changes the bot: both
 * stay the owner's. `waitingCall` reads the card's call, only when needed.
 */
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

/** The app-wide feed's connection states are the owner's. */
export function seesConnections(viewer: Viewer): boolean {
  return viewer.kind === "owner";
}

/** Only the owner's open chat counts as watched: a guest following it must not hold back the owner's pushes (S2). */
export function countsAsWatching(viewer: Viewer): boolean {
  return viewer.kind === "owner";
}

/** A guest's live view is watch-only: the VNC bridge drops its input (S2). */
export function watchOnly(viewer: Viewer): boolean {
  return viewer.kind === "guest";
}

/**
 * What a viewer's Code page may offer (S3): the host's directories, files,
 * uploads and worktrees and the no-prompts mode are the owner's, so a guest's
 * page hides those controls; the routes refuse them anyway.
 */
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

/**
 * Starting or changing a Code thread (S3): a guest may not run without
 * permission prompts, or pick a working directory (directory choice is the
 * owner's, as is browsing the host; see GUEST_ACCESS).
 */
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

/** Opening a Code asset: a file ref names any path on the harness host; a guest opens only a message's own images (S3). */
export function requireCodeAsset(viewer: Viewer, ref: string): void {
  if (viewer.kind === "guest" && !ref.startsWith("img:")) {
    throw Boom.forbidden("Only the owner can open files from the harness host.");
  }
}
