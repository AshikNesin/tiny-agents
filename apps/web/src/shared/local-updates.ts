/**
 * Self-updates for a local install (docs/guides/local-updates.md). `pnpm local`
 * (scripts/local.ts) runs the server as its child over an IPC channel: it
 * builds new commits beside the running release and swaps them in. These are
 * the messages both sides send, and the status the Settings page shows.
 */

/** One commit, short sha and subject. */
export interface UpdateCommit {
  sha: string;
  subject: string;
}

/** A built (or buildable) commit of the tracked ref. */
export interface UpdateRelease {
  sha: string;
  /** `package.json` version at that commit. */
  version: string;
  subject: string;
  /** Commit time, ms since the epoch. */
  committedAt: number;
}

export type UpdatePhase = "idle" | "checking" | "building" | "restarting" | "failed";

export interface UpdateStatus {
  /** The ref the supervisor follows: `origin/main`, or the newest `v*` tag. */
  track: string;
  current: UpdateRelease;
  /** The tracked ref's head; equals `current` when up to date. */
  latest: UpdateRelease | null;
  /** Commits in `latest` not in `current`, newest first (at most 50). */
  commits: UpdateCommit[];
  /** The update changes `docker/sandbox/`: run `pnpm sandbox:up` after it. */
  sandboxChanged: boolean;
  phase: UpdatePhase;
  /** What the last failed check or update said. */
  error: string | null;
  /** The last lines of the running build, for the progress view. */
  log: string[];
  /** Apply updates as soon as they are built (`pnpm local --auto`). */
  auto: boolean;
  lastCheckedAt: number | null;
}

/** Supervisor → server. */
export type SupervisorMessage = { type: "update-status"; status: UpdateStatus };

/** Server → supervisor. */
export type ServerMessage =
  | { type: "server-ready" }
  | { type: "update-check" }
  | { type: "update-apply" };

/** What `GET /api/v1/system/update` answers. `status` is null when not run by `pnpm local`. */
export interface UpdateView {
  supervised: boolean;
  status: UpdateStatus | null;
}

export function isSupervisorMessage(value: unknown): value is SupervisorMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "update-status" &&
    typeof (value as { status?: unknown }).status === "object"
  );
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === "server-ready" || type === "update-check" || type === "update-apply";
}
