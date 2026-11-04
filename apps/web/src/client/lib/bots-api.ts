/**
 * Typed client for the bots API (PRD §9). Mirrors the server's shapes;
 * `apiClient` unwraps the { success, data } envelope.
 */
import { apiClient } from "@groot/shell/lib/api";
import type { OwnerAnswer } from "./chat-types";
import type { ChatMessage, RoutineRunCard } from "./chat-types";

export interface ModelInfo {
  id: string;
  name: string;
  family: "anthropic" | "openai" | "workers-ai" | "claude-plan" | "other";
  /** Display name of the provider serving it ("Cloudflare AI Gateway", "OpenAI"). */
  provider?: string;
  reasoning: boolean;
  contextWindow: number;
  /** The model accepts image content natively (issue #17). */
  vision: boolean;
  /** Short picker note, e.g. "uses your Claude plan". */
  note?: string;
}

/** One inference provider (AI_PROVIDERS) and whether it has credentials. */
export interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  setupHint: string;
}

export interface ModelsResponse {
  models: ModelInfo[];
  defaultModel?: string;
  /** Some provider can answer (the name predates providers other than the gateway). */
  gatewayConfigured: boolean;
  providers?: ProviderStatus[];
}

/** Claude plan engine status. Never includes a credential or the worker token. */
export interface ClaudeCodeStatus {
  enabled: boolean;
  fallback: "gateway" | "pause";
  configured: boolean;
  /** `sandbox`: the app runs the worker on the sandbox. `none`: no sandbox configured. */
  mode: "sandbox" | "none";
  workerHost?: string;
}

/** Whether Claude Code is installed and signed in where the worker runs. Never a credential. */
export type ClaudeCodeAccount =
  | { state: "unconfigured" }
  | { state: "installing" }
  | { state: "error"; detail: string }
  | { state: "ready"; loggedIn: boolean; subscription: boolean; plan?: string; detail?: string };

export const claudeCodeApi = {
  status: () => apiClient.get<ClaudeCodeStatus>("/claude-code/status"),
  account: () => apiClient.get<ClaudeCodeAccount>("/claude-code/account"),
};

export type ToolPermission = "allow" | "ask" | "off";

export interface BotListEntry {
  id: string;
  conversationId: string;
  name: string;
  description: string;
  modelId: string;
  lastMessagePreview: string | null;
  lastActivityAt: string;
  /** Pre-open read marker (epoch ms) — the open-at-unread scroll uses it. */
  lastReadAt: string | null;
  unread: boolean;
  replying: boolean;
  /** Tool calls waiting for the owner's approval. */
  approvals: number;
  /** Questions (ask_owner calls) waiting for the owner's answers. */
  questions: number;
  /** ISO time the owner pinned the bot; null when not pinned. */
  pinnedAt: string | null;
}

export interface Bot {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string;
  conversationId: string;
  lastReadAt: string | null;
  lastActivityAt: string;
  lastMessagePreview: string | null;
  toolPermissions: Record<string, ToolPermission>;
  skillIds: string[];
  connectionIds: string[];
  /** Memory capture + injection switch (issue #22). */
  memoryEnabled: boolean;
  /** Auto-review (issue #65): a classifier may approve "ask" tool calls. */
  autoReview: boolean;
  /** `shared`: the browser (and logins) every such bot uses; `own`: a browser of its own. */
  browserProfile: BrowserProfile;
  pinnedAt: string | null;
  /** Guests the bot is shared with (issue #145): they are in its chat. */
  guestIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentRef {
  uploadId: string;
  kind: "image" | "file";
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  /** Files: extraction state when the ref was made (issue #58). */
  status?: UploadExtractStatus;
}

export type UploadExtractStatus = "none" | "pending" | "ready" | "failed" | "unsupported";

/** An upload's live extraction state (GET /uploads/:id). */
export interface UploadStatus {
  ref: AttachmentRef;
  status: UploadExtractStatus;
  error?: string;
  meta?: {
    format?: string;
    pages?: number;
    sheets?: number;
    lines?: number;
    entries?: number;
    truncated?: boolean;
  };
}

/** One page of extracted text for the read-only preview (GET /uploads/:id/text). */
export type UploadText =
  | { status: "ready"; format: string; page: number; pages: number; label: string; text: string }
  | {
      status: "ready";
      format: string;
      sheets: { name: string; hidden: boolean }[];
      sheet: number;
      rows: string[][];
      totalRows: number;
    }
  | {
      status: "ready";
      format: string;
      entries: { path: string; size: number; dir?: boolean; flag?: string }[];
    }
  | { status: Exclude<UploadExtractStatus, "ready">; error?: string };

export interface ToolInfo {
  name: string;
  /** Past tense, for the transcript ("Opened a page"). */
  label: string;
  /** Completes "<bot> wants to …" ("open a page"); connection tools have none. */
  askLabel?: string;
  description: string;
  readOnly?: boolean;
  askOnly?: boolean;
  allowByDefault?: boolean;
}

export interface CapabilityInfo {
  id: string;
  kind: "toolkit" | "skills" | "connection";
  name: string;
  description: string;
  tools: ToolInfo[];
  setupHint?: string;
  /** Switched on and off by the app itself; not shown in a bot's settings. */
  auto?: boolean;
}

export interface BotInput {
  name: string;
  description?: string;
  systemPrompt?: string;
  modelId: string;
  toolPermissions?: Record<string, ToolPermission>;
  skillIds?: string[];
  connectionIds?: string[];
  /** Guests to share the bot with; replaces the current list. */
  guestIds?: number[];
  memoryEnabled?: boolean;
  autoReview?: boolean;
  browserProfile?: BrowserProfile;
}

export type BrowserProfile = "shared" | "own";

export const MEMORY_CATEGORIES = ["preference", "fact", "goal", "habit"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/** Only `active` is ever injected; the rest is visible history (issue #22 5.4). */
export type MemoryStatus = "active" | "superseded" | "archived" | "expired" | "deleted";

export type MemorySource = "capture" | "manual";

/** Category display order, the same order the injected block renders in. */
export const CATEGORY_ORDER: readonly MemoryCategory[] = ["preference", "fact", "goal", "habit"];

export const MEMORY_TEXT_MAX = 300;

/** A memory row as the API returns it (ISO dates, typed enums). */
export interface MemoryRecord {
  id: string;
  botId: string;
  text: string;
  category: MemoryCategory;
  status: MemoryStatus;
  source: MemorySource;
  confidence: number | null;
  until: string | null;
  supersededById: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryInput {
  text: string;
  category: MemoryCategory;
  until?: string | null;
}

export type MemoryUpdate = Partial<Pick<MemoryInput, "text" | "category">> & {
  until?: string | null;
  restore?: boolean;
};

// Capabilities are static per server boot, and every chat/dialog mount asks
// for them, so memoize the promise: one request serves the whole session
// (a page reload picks up a restarted server). A rejection clears the cache
// so the next call retries instead of failing forever.
let capabilitiesCache: Promise<CapabilityInfo[]> | null = null;

/**
 * The route returns `{ capabilities }`; unwrap here so callers get the
 * array (a raw `.get<CapabilityInfo[]>()` would hand them the wrapper
 * object and crash on the first `.filter`/`.flatMap`).
 */
async function fetchCapabilities(): Promise<CapabilityInfo[]> {
  try {
    return (
      (await apiClient.get<{ capabilities: CapabilityInfo[] }>("/capabilities")).capabilities ?? []
    );
  } catch (error) {
    capabilitiesCache = null;
    throw error;
  }
}

/** A conversation the bot ran on before a "New chat" (issue #101). */
export interface PastChat {
  id: string;
  /** Model-written title; the first owner message until it arrives. */
  title: string | null;
  startedAt: string;
  endedAt: string;
  lastMessagePreview: string | null;
  messageCount: number;
}

/** A past chat to read: its newest messages (older ones page in) and its routine cards. */
export interface PastChatView {
  chat: PastChat;
  state: { messages: ChatMessage[]; hasMore?: boolean };
  runs: RoutineRunCard[];
}

export const botsApi = {
  list: () => apiClient.get<BotListEntry[]>("/bots"),
  create: (input: BotInput) => apiClient.post<Bot>("/bots", input),
  get: (id: string) => apiClient.get<Bot>(`/bots/${id}`),
  /** Older messages, just before message `before` (issue #92). */
  history: (id: string, before: string, limit = 50) =>
    apiClient.get<{ messages: ChatMessage[]; hasMore: boolean }>(`/bots/${id}/messages`, {
      before,
      limit,
    }),
  update: (id: string, input: Partial<BotInput>) => apiClient.patch<Bot>(`/bots/${id}`, input),
  remove: (id: string) => apiClient.delete(`/bots/${id}`),
  models: () => apiClient.get<ModelsResponse>("/models"),
  send: (
    id: string,
    requestId: string,
    text: string,
    mentions?: string[],
    attachments?: string[],
    whenBusy?: "steer" | "followUp",
  ) =>
    apiClient.post(`/bots/${id}/messages`, {
      requestId,
      text,
      ...(mentions?.length ? { mentions } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(whenBusy ? { whenBusy } : {}),
    }),
  /** Withdraw a queued message (the x on a queued/steering bubble). */
  withdraw: (id: string, requestId: string) =>
    apiClient.delete(`/bots/${id}/messages/${encodeURIComponent(requestId)}`),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.postForm<{ ref: AttachmentRef }>("/uploads", form);
  },
  uploadUrl: (uploadId: string) => `/api/v1/uploads/${uploadId}/content`,
  uploadStatus: (uploadId: string) => apiClient.get<UploadStatus>(`/uploads/${uploadId}`),
  uploadText: (uploadId: string, params: { page?: number; sheet?: number } = {}) =>
    apiClient.get<UploadText>(`/uploads/${uploadId}/text`, params),
  deleteUpload: (uploadId: string) => apiClient.delete(`/uploads/${uploadId}`),
  abort: (id: string) => apiClient.post(`/bots/${id}/abort`),
  reset: (id: string) => apiClient.post<Bot>(`/bots/${id}/reset`),
  pastChats: (id: string) =>
    apiClient.get<{ chats: PastChat[] }>(`/bots/${id}/chats`).then((r) => r.chats),
  pastChat: (id: string, chatId: string) =>
    apiClient.get<PastChatView>(`/bots/${id}/chats/${chatId}`),
  /** Older messages of a past chat, just before message `before`. */
  pastChatHistory: (id: string, chatId: string, before: string, limit = 50) =>
    apiClient.get<{ messages: ChatMessage[]; hasMore: boolean }>(
      `/bots/${id}/chats/${chatId}/messages`,
      { before, limit },
    ),
  /** Move the bot back onto a past chat; the chat it was on becomes a past chat. */
  continuePastChat: (id: string, chatId: string) =>
    apiClient.post<Bot>(`/bots/${id}/chats/${chatId}/continue`),
  deletePastChat: (id: string, chatId: string) => apiClient.delete(`/bots/${id}/chats/${chatId}`),
  read: (id: string) => apiClient.post(`/bots/${id}/read`),
  pin: (id: string, pinned: boolean) => apiClient.post<Bot>(`/bots/${id}/pin`, { pinned }),
  capabilities: () => (capabilitiesCache ??= fetchCapabilities()),
  decideApproval: (
    id: string,
    taskId: number,
    decision: "approved" | "denied",
    alwaysAllow?: string,
    /** Vault cards: approve this handle for the rest of the conversation. */
    grant?: boolean,
  ) =>
    apiClient.post(`/bots/${id}/approvals/${taskId}`, {
      decision,
      ...(alwaysAllow ? { alwaysAllow } : {}),
      ...(grant ? { grant } : {}),
    }),
  /** Answer a bot's questions (one answer per question), or dismiss them with `null`. */
  answerQuestions: (id: string, taskId: number, answers: OwnerAnswer[] | null) =>
    apiClient.post(`/bots/${id}/questions/${taskId}`, answers ? { answers } : { dismissed: true }),
  browserStatus: (id: string) => apiClient.get<BrowserStatus>(`/bots/${id}/browser`),
  browserDriver: (id: string, driver: "agent" | "human") =>
    apiClient.post(`/bots/${id}/browser/driver`, { driver }),
  browserStart: (id: string) => apiClient.post<{ starting: boolean }>(`/bots/${id}/browser/start`),
  browserVncTicket: (id: string) =>
    apiClient.post<BrowserVncTicket>(`/bots/${id}/browser/vnc-ticket`),
  browserResize: (id: string, size: { width: number; height: number }) =>
    apiClient.post(`/bots/${id}/browser/resize`, size),
  browserResetProfile: (id: string) => apiClient.delete(`/bots/${id}/browser/profile`),
  computerStatus: (id: string) => apiClient.get<ComputerStatus>(`/bots/${id}/computer`),
  computerDriver: (id: string, driver: "agent" | "human") =>
    apiClient.post(`/bots/${id}/computer/driver`, { driver }),
  computerStart: (id: string) =>
    apiClient.post<{ starting: boolean }>(`/bots/${id}/computer/start`),
  computerVncTicket: (id: string) =>
    apiClient.post<BrowserVncTicket>(`/bots/${id}/computer/vnc-ticket`),
  computerReset: (id: string) => apiClient.delete(`/bots/${id}/computer/profile`),
  listMemories: (id: string, includeArchived = true) =>
    apiClient.get<{ memories: MemoryRecord[] }>(`/bots/${id}/memories`, { includeArchived }),
  createMemory: (id: string, input: MemoryInput) =>
    apiClient.post<{ memory: MemoryRecord }>(`/bots/${id}/memories`, input),
  updateMemory: (id: string, input: MemoryUpdate) =>
    apiClient.patch<{ memory: MemoryRecord }>(`/memories/${id}`, input),
  deleteMemory: (id: string) => apiClient.delete<{ deleted: boolean }>(`/memories/${id}`),
};

/** Live browser session state for a bot (issue #24). */
export interface BrowserStatus {
  active: boolean;
  /** Whether the bot uses the shared browser (other bots too) or its own. */
  profile?: BrowserProfile;
  /** The bot's own tab; null until it has one. */
  url: string | null;
  driver: "agent" | "human" | null;
  /** `vnc`: a streamed desktop with a full Chrome UI; `headless`: usable by the bot, no live view. */
  mode?: "vnc" | "headless" | null;
  /** Pixel density of the VNC desktop. */
  scale?: number | null;
  /** The browser is opening; `installing` is the one-time VM setup. */
  starting?: boolean;
  phase?: "installing" | "starting" | null;
  /** Why the last open attempt failed, until the next attempt. */
  error?: string | null;
}

/** The bot's computer (issue #108): an XFCE desktop on the sandbox VM. */
export interface ComputerStatus {
  /** False without a sandbox VM; `setupHint` says what to set. */
  configured: boolean;
  setupHint: string | null;
  active: boolean;
  /** Whether the bot shares the desktop with other bots or has its own. */
  profile: BrowserProfile;
  driver: "agent" | "human" | null;
  /** The desktop's fixed size, which the viewer scales. */
  width: number | null;
  height: number | null;
  /** What the bot asked the owner to do while it waits for a hand-back. */
  takeover: string | null;
  starting: boolean;
  phase: "installing" | "starting" | null;
  error: string | null;
}

/** One-time credential for the VNC WebSocket; `path` is same-origin. */
export interface BrowserVncTicket {
  path: string;
  scale: number;
}
