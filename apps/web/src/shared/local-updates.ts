export interface UpdateCommit {
  sha: string;
  subject: string;
}

export interface UpdateRelease {
  sha: string;
  version: string;
  subject: string;
  committedAt: number;
}

export type UpdatePhase = "idle" | "checking" | "building" | "restarting" | "failed";

export interface UpdateStatus {
  track: string;
  current: UpdateRelease;
  latest: UpdateRelease | null;
  commits: UpdateCommit[];
  sandboxChanged: boolean;
  phase: UpdatePhase;
  error: string | null;
  log: string[];
  auto: boolean;
  lastCheckedAt: number | null;
}

export type SupervisorMessage = { type: "update-status"; status: UpdateStatus };

export type ServerMessage =
  | { type: "server-ready" }
  | { type: "update-check" }
  | { type: "update-apply" };

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
