/**
 * The Code page's client (ADR 0011): one API for every harness, through
 * this app's `/code` routes (apps/web/src/server/api/code/code.routes.ts).
 * Types are the harness contracts (`@tiny-agents/code/contracts`).
 */
import { apiClient } from "@groot/shell/lib/api";
import { LEGACY_INSTANCE_ID, parseThreadId, threadIdOf } from "@tiny-agents/code/contracts";
import type {
  Capabilities,
  CodeListEvent,
  CodeThreadEvent,
  DirectoryListing,
  FileMatch,
  GitDiff,
  GitFile,
  GitFileDiff,
  InstanceStatus,
  ModelOption,
  PermissionMode,
  RecoveryAction,
  RequestAnswer,
  Skill,
  SlashCommand,
  ThreadSettings,
  ThreadSnapshot,
  ThreadSummary,
  UsageReport,
} from "@tiny-agents/code/contracts";

export type * from "@tiny-agents/code/contracts";
export type { CodeListEvent, CodeThreadEvent };

/** One configured harness as the page sees it. */
export interface HarnessInfo {
  id: string;
  kind: string;
  label: string;
  status: InstanceStatus;
  capabilities: Capabilities;
  commands: SlashCommand[];
}

const base = "/code";
const thread = (id: string) => `${base}/threads/${encodeURIComponent(id)}`;
const harness = (instanceId: string) => `${base}/harnesses/${encodeURIComponent(instanceId)}`;

export const codeApi = {
  status: () => apiClient.get<{ harnesses: HarnessInfo[] }>(`${base}/status`),
  /** The app-wide stream (status and the merged list). */
  eventsPath: () => `/api/v1${base}/events`,
  /** One thread, live: a snapshot, then changes. */
  threadEventsPath: (id: string) => `/api/v1${thread(id)}/events`,

  list: (view: "active" | "archived" = "active") =>
    apiClient.get<ThreadSummary[]>(`${base}/threads`, { view }),
  search: (q: string, archived = false) =>
    apiClient.get<ThreadSummary[]>(`${base}/threads/search`, {
      q,
      archived: archived ? "true" : undefined,
    }),
  byTitle: (title: string) =>
    apiClient.get<ThreadSummary>(`${base}/threads/by-title/${encodeURIComponent(title)}`),
  get: (id: string) => apiClient.get<ThreadSnapshot>(thread(id)),
  markSeen: (id: string, cursor: number) => apiClient.post(`${thread(id)}/seen`, { cursor }),

  create: (input: {
    instanceId: string;
    message: string;
    /** Start in a project: its own worktree on a new branch (issue #297). */
    projectId?: string;
    cwd?: string;
    model?: string;
    effort?: string;
    permissionMode?: PermissionMode;
    attachments?: string[];
  }) => apiClient.post<{ threadId: string }>(`${base}/threads`, input),
  send: (
    id: string,
    message: string,
    options: { queue?: boolean; skills?: string[]; attachments?: string[] } = {},
  ) =>
    apiClient.post<{ status: "accepted" | "queued" }>(`${thread(id)}/messages`, {
      message,
      ...options,
    }),
  interrupt: (id: string) => apiClient.post(`${thread(id)}/interrupt`),
  respond: (id: string, requestId: string, answer: RequestAnswer) =>
    apiClient.post(`${thread(id)}/requests/${encodeURIComponent(requestId)}`, answer),
  recover: (id: string, action: RecoveryAction) =>
    apiClient.post(`${thread(id)}/recover`, { action }),
  queued: (id: string, queuedId: string, action: "send" | "cancel") =>
    apiClient.post(`${thread(id)}/queued/${encodeURIComponent(queuedId)}/${action}`),
  killJob: (id: string, jobId: string) =>
    apiClient.post(`${thread(id)}/jobs/${encodeURIComponent(jobId)}/kill`),
  settings: (id: string, change: Partial<ThreadSettings>) =>
    apiClient.post<ThreadSettings>(`${thread(id)}/settings`, change),
  /** Archive (with subagents) or restore; answers the subagents that moved too. */
  archive: (id: string, archived: boolean) =>
    apiClient.post<{ moved: string[] }>(`${thread(id)}/archive`, { archived }),
  remove: (id: string) => apiClient.delete(thread(id)),
  rename: (id: string, title: string) => apiClient.post(`${thread(id)}/rename`, { title }),
  setCwd: (id: string, cwd: string) => apiClient.post(`${thread(id)}/cwd`, { cwd }),
  fork: (id: string, at: string) =>
    apiClient.post<{ threadId: string }>(`${thread(id)}/fork`, { at }),
  usage: (id: string) => apiClient.get<UsageReport>(`${thread(id)}/usage`),

  models: (instanceId: string) => apiClient.get<ModelOption[]>(`${harness(instanceId)}/models`),
  skills: (instanceId: string, cwd: string, threadId?: string) =>
    apiClient.get<Skill[]>(`${harness(instanceId)}/skills`, { cwd, threadId }),
  findFiles: (instanceId: string, dir: string, q: string, content?: "only") =>
    apiClient.get<FileMatch[]>(`${harness(instanceId)}/find-files`, { dir, q, content }),
  directories: (instanceId: string, path?: string) =>
    apiClient.get<DirectoryListing>(`${harness(instanceId)}/directories`, { path }),
  validateCwd: (instanceId: string, path: string) =>
    apiClient.get<{ valid: boolean; error?: string }>(`${harness(instanceId)}/validate-cwd`, {
      path,
    }),
  repos: (instanceId: string) =>
    apiClient.get<{ repos: Array<{ path: string; name?: string }> }>(
      `${harness(instanceId)}/repos`,
    ),
  createWorktree: (instanceId: string, cwd: string) =>
    apiClient.post<{ path: string }>(`${harness(instanceId)}/worktrees`, { cwd }),
  diffs: (instanceId: string, cwd: string) =>
    apiClient.get<{ diffs: GitDiff[]; gitRoot: string }>(`${harness(instanceId)}/diffs`, {
      cwd,
    }),
  diffFiles: (instanceId: string, diffId: string, cwd: string) =>
    apiClient.get<GitFile[]>(`${harness(instanceId)}/diffs/${encodeURIComponent(diffId)}/files`, {
      cwd,
    }),
  fileDiff: (instanceId: string, diffId: string, cwd: string, path: string) =>
    apiClient.get<GitFileDiff>(`${harness(instanceId)}/diffs/${encodeURIComponent(diffId)}/file`, {
      cwd,
      path,
    }),

  /** An image or file a harness serves (screenshots, uploads). */
  assetUrl: (instanceId: string, ref: string) =>
    `/api/v1${harness(instanceId)}/asset?ref=${encodeURIComponent(ref)}`,

  /** Raw upload; answers the ref to pass as an attachment. */
  async upload(instanceId: string, file: File): Promise<string> {
    const response = await fetch(
      `/api/v1${base}/uploads/${encodeURIComponent(instanceId)}?filename=${encodeURIComponent(file.name || "pasted")}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      },
    );
    const envelope = (await response.json().catch(() => ({}))) as {
      data?: { ref?: string };
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data?.ref) {
      throw new Error(envelope.error?.message ?? `Upload failed (${response.status})`);
    }
    return envelope.data.ref;
  },
};

/** The instance part of a thread id (`shelley:c1` → `shelley`); legacy bare ids are Shelley's. */
export function instanceOf(threadId: string): string {
  return parseThreadId(threadId, LEGACY_INSTANCE_ID)?.instanceId ?? LEGACY_INSTANCE_ID;
}

/** A thread id for links: legacy bare ids (from old chats and pushes) become Shelley's. */
export function normalizeThreadId(id: string): string {
  const parsed = parseThreadId(id, LEGACY_INSTANCE_ID);
  return parsed ? threadIdOf(parsed.instanceId, parsed.nativeId) : id;
}

/** The thread's page. */
export function threadPath(id: string, suffix = ""): string {
  return `/code/${encodeURIComponent(id)}${suffix}`;
}

/** "~/app" style label: the last two path segments. */
export function shortPath(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}
