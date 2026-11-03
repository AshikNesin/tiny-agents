/**
 * The Code page's client for Shelley (issue #143), through this app's
 * curated `/shelley` proxy (apps/web/src/server/api/shelley/shelley.routes.ts).
 * Types mirror Shelley's wire format (its API.md and ui/src/types.ts).
 */
import { apiClient } from "@groot/shell/lib/api";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface HubConnection {
  state: "disabled" | "connecting" | "connected" | "reconnecting";
  error?: string;
}

export interface ShelleyStatus {
  configured: boolean;
  publicUrl: string | null;
  connection: HubConnection;
}

/** A conversation row (Shelley's snapshot plus what tiny-agents tracks). */
export interface ShelleyConversation {
  conversation_id: string;
  slug: string | null;
  cwd: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
  archived?: boolean;
  parent_conversation_id: string | null;
  user_initiated?: boolean;
  working: boolean;
  agent_working?: boolean;
  preview?: string;
  preview_updated_at?: string;
  max_sequence_id?: number;
  subagent_count?: number;
  running_background_jobs?: number;
  queued_messages?: string;
  turn_interrupted?: boolean;
  conversation_options?: string;
  tags?: string;
  git_repo_root?: string;
  git_worktree_root?: string;
  git_commit?: string;
  git_subject?: string;
  /** tiny-agents: started, opened or handed off here. */
  followed?: boolean;
  /** tiny-agents: its turn ended after the owner last looked. */
  unread?: boolean;
}

export interface ShelleyMessage {
  message_id: string;
  conversation_id?: string;
  sequence_id: number;
  type: string;
  llm_data?: string | null;
  user_data?: string | null;
  usage_data?: string | null;
  display_data?: string | null;
  created_at: string;
  end_of_turn?: boolean | null;
  model_name?: string | null;
}

export interface ConversationDetail {
  messages: ShelleyMessage[];
  conversation: ShelleyConversation;
  context_window_size?: number;
  max_sequence_id?: number;
  subagents: ShelleyConversation[];
}

/** One `stream2` frame (relayed by our hub). */
export interface ShelleyFrame {
  conversation_id?: string;
  messages?: ShelleyMessage[];
  conversation?: ShelleyConversation;
  conversation_state?: { working: boolean; model?: string };
  context_window_size?: number;
  tool_progress?: { tool_use_id: string; tool_name: string; output: string };
  stream_delta?: { type: "text" | "thinking" | "tool_input"; text: string; index?: number };
}

export type ShelleyEvent =
  | { type: "status"; connection: HubConnection }
  | { type: "list"; conversations: ShelleyConversation[] }
  | { type: "frame"; frame: ShelleyFrame }
  | { type: "ping" }
  | { type: "error"; message: string };

export interface ShelleyModel {
  id: string;
  display_name?: string;
  ready: boolean;
  is_default?: boolean;
  max_context_tokens?: number;
  supports_images?: boolean;
  supports_reasoning?: boolean;
}

export interface ConversationSettings {
  profile?: string;
  model: string;
  thinking_level: string;
  tool_overrides?: Record<string, string>;
}

export interface BackgroundJob {
  id: string;
  command?: string;
  started_at?: string;
  status?: string;
  [field: string]: unknown;
}

export interface QueuedMessage {
  id: string;
  text: string;
  createdAt: string;
  /** A subagent reporting back, rather than the owner. */
  fromSubagent?: string;
}

export interface Skill {
  name: string;
  description?: string;
}

export interface FindFilesMatch {
  path: string;
  is_dir?: boolean;
  line?: number;
  text?: string;
}

export interface DirectoryListing {
  path: string;
  parent?: string;
  entries: Array<{ name: string; is_dir: boolean }>;
  git_repo_root?: string;
  git_head_subject?: string;
}

export interface GitDiff {
  id: string;
  message: string;
  author: string;
  timestamp: string;
  filesCount: number;
  additions: number;
  deletions: number;
  refs?: string[];
}

export interface GitFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  isGenerated: boolean;
}

export interface GitFileDiff {
  path: string;
  oldContent: string;
  newContent: string;
}

export interface SubagentUsage {
  llm_calls: number;
  reported_usd: number;
  estimated_usd: number;
}

const base = "/shelley";
const conv = (id: string) => `${base}/conversations/${encodeURIComponent(id)}`;

export const shelleyApi = {
  status: () => apiClient.get<ShelleyStatus>(`${base}/status`),
  /** The app-wide list stream, or one conversation's frames (`list=0`). */
  eventsPath: (conversationId?: string) =>
    `/api/v1${base}/events${conversationId ? `?conversation=${encodeURIComponent(conversationId)}&list=0` : ""}`,

  list: (view: "active" | "archived" = "active") =>
    apiClient.get<ShelleyConversation[]>(`${base}/conversations`, { view }),
  search: (q: string, archived = false) =>
    apiClient.get<ShelleyConversation[]>(`${base}/conversations/search`, {
      q,
      archived: archived ? "true" : undefined,
    }),
  bySlug: (slug: string) =>
    apiClient.get<ShelleyConversation>(`${base}/conversations/by-slug/${encodeURIComponent(slug)}`),
  get: (id: string) => apiClient.get<ConversationDetail>(conv(id)),
  settings: (id: string) => apiClient.get<ConversationSettings>(`${conv(id)}/settings`),
  backgroundJobs: (id: string) => apiClient.get<BackgroundJob[]>(`${conv(id)}/background-jobs`),
  subagentUsage: (id: string) => apiClient.get<SubagentUsage>(`${conv(id)}/subagent-usage`),
  markSeen: (id: string, sequenceId: number) => apiClient.post(`${conv(id)}/seen`, { sequenceId }),

  create: (input: {
    message: string;
    cwd?: string;
    model?: string;
    thinkingLevel?: ThinkingLevel;
  }) => apiClient.post<{ conversationId: string }>(`${base}/conversations`, input),
  createWorktree: (cwd: string) =>
    apiClient.post<{ path?: string; worktree?: string; cwd?: string }>(`${base}/worktrees`, {
      cwd,
    }),

  chat: (id: string, message: string, options: { queue?: boolean; skills?: string[] } = {}) =>
    apiClient.post<{ status: string }>(`${conv(id)}/chat`, { message, ...options }),
  action: (
    id: string,
    action: "cancel" | "retry" | "resume" | "new-generation" | "archive" | "unarchive" | "delete",
    // archive / unarchive move the conversation's subagents too and list them.
  ) => apiClient.post<{ subagents?: string[] } | undefined>(`${conv(id)}/${action}`),
  continueWith: (id: string, model?: string) => apiClient.post(`${conv(id)}/continue`, { model }),
  fork: (id: string, messageId: string) =>
    apiClient.post<{ conversation_id?: string }>(`${conv(id)}/fork`, { message_id: messageId }),
  setCwd: (id: string, cwd: string) => apiClient.post(`${conv(id)}/cwd`, { cwd }),
  rename: (id: string, slug: string) => apiClient.post(`${conv(id)}/rename`, { slug }),
  setSettings: (id: string, change: { model?: string; thinking_level?: string }) =>
    apiClient.post<ConversationSettings>(`${conv(id)}/settings`, change),
  queued: (id: string, action: "send" | "cancel" | "retry", queuedId?: string) =>
    apiClient.post(
      `${conv(id)}/queued/${action}${queuedId ? `?queuedId=${encodeURIComponent(queuedId)}` : ""}`,
    ),
  killJob: (id: string, jobId: string) =>
    apiClient.post(`${conv(id)}/background-jobs/${encodeURIComponent(jobId)}/kill`),

  models: () => apiClient.get<ShelleyModel[]>(`${base}/models`),
  skills: (cwd: string, conversationId?: string) =>
    apiClient.get<{ skills: Skill[] }>(`${base}/skills`, { cwd, conversationId }),
  findFiles: (dir: string, q: string, content?: "only") =>
    apiClient.get<{ search_dir: string; matches: FindFilesMatch[] }>(`${base}/find-files`, {
      dir,
      q,
      content,
      includeDirs: content ? undefined : "true",
    }),
  directories: (path?: string) => apiClient.get<DirectoryListing>(`${base}/directories`, { path }),
  validateCwd: (path: string) =>
    apiClient.get<{ valid: boolean; error?: string }>(`${base}/validate-cwd`, { path }),
  repos: () =>
    apiClient.get<{ repos: Array<{ path: string; name?: string }> | null }>(`${base}/repos`),

  diffs: (cwd: string) =>
    apiClient.get<{ diffs: GitDiff[]; gitRoot: string }>(`${base}/diffs`, { cwd }),
  diffFiles: (diffId: string, cwd: string) =>
    apiClient.get<GitFile[]>(`${base}/diffs/${encodeURIComponent(diffId)}/files`, { cwd }),
  fileDiff: (diffId: string, cwd: string, path: string) =>
    apiClient.get<GitFileDiff>(`${base}/diffs/${encodeURIComponent(diffId)}/file`, { cwd, path }),

  /** A file on Shelley's machine (screenshots, referenced paths). */
  fileUrl: (path: string) => `/api/v1${base}/files?path=${encodeURIComponent(path)}`,
  imageUrl: (shelleyUrl: string) => {
    // Shelley serves images at /api/message/<id>/image/<c>/<t>; we proxy them.
    const match = /\/api\/message\/([A-Za-z0-9_-]+)\/image\/(-?\d+)\/(-?\d+)/.exec(shelleyUrl);
    if (match) return `/api/v1${base}/messages/${match[1]}/image/${match[2]}/${match[3]}`;
    const read = /\/api\/read\?path=([^&]+)/.exec(shelleyUrl);
    if (read) return `/api/v1${base}/files?path=${read[1]}`;
    return undefined;
  },

  /** Raw upload; answers the path to reference as `[path]` in a message. */
  async upload(file: File): Promise<string> {
    const response = await fetch(
      `/api/v1${base}/uploads?filename=${encodeURIComponent(file.name || "pasted")}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      },
    );
    const envelope = (await response.json().catch(() => ({}))) as {
      data?: { path?: string };
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data?.path) {
      throw new Error(envelope.error?.message ?? `Upload failed (${response.status})`);
    }
    return envelope.data.path;
  },
};

export function conversationTitle(c: Pick<ShelleyConversation, "slug" | "conversation_id">) {
  return c.slug || c.conversation_id;
}

/** "~/app" style label: the last two path segments. */
export function shortPath(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

/** Queued messages from a conversation row (`queued_messages` is a JSON string). */
export function queuedMessages(row: Pick<ShelleyConversation, "queued_messages"> | undefined) {
  if (!row?.queued_messages) return [];
  try {
    const items = JSON.parse(row.queued_messages) as Array<{
      id: string;
      created_at?: string;
      llm?: { Content?: Array<{ Type?: number; Text?: string }> };
      user_data?: { sender_slug?: string; sender_relationship?: string };
    }>;
    return items.map((item): QueuedMessage => ({
      id: item.id,
      text: (item.llm?.Content ?? [])
        .filter((c) => c.Type === 2 && c.Text)
        .map((c) => c.Text)
        .join("\n"),
      createdAt: item.created_at ?? "",
      ...(item.user_data?.sender_slug ? { fromSubagent: item.user_data.sender_slug } : {}),
    }));
  } catch {
    return [];
  }
}
