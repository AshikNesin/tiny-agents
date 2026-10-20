/**
 * Typed client for the bots API (PRD §9). Mirrors the server's shapes;
 * `apiClient` unwraps the { success, data } envelope.
 */
import { apiClient } from "@groot/shell/lib/api";

export interface ModelInfo {
  id: string;
  name: string;
  family: "anthropic" | "openai" | "workers-ai" | "other";
  reasoning: boolean;
  contextWindow: number;
  /** The model accepts image content natively (issue #17). */
  vision: boolean;
}

export interface ModelsResponse {
  models: ModelInfo[];
  defaultModel?: string;
  gatewayConfigured: boolean;
}

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
  toolkits: string[];
  toolPermissions: Record<string, ToolPermission>;
  skillIds: string[];
  connectionIds: string[];
  /** Memory capture + injection switch (issue #22). */
  memoryEnabled: boolean;
  pinnedAt: string | null;
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
}

export interface ToolInfo {
  name: string;
  label: string;
  description: string;
  readOnly?: boolean;
  askOnly?: boolean;
}

export interface CapabilityInfo {
  id: string;
  kind: "toolkit" | "skills" | "connection";
  name: string;
  description: string;
  tools: ToolInfo[];
  setupHint?: string;
}

export interface BotInput {
  name: string;
  description?: string;
  systemPrompt?: string;
  modelId: string;
  toolkits?: string[];
  toolPermissions?: Record<string, ToolPermission>;
  skillIds?: string[];
  connectionIds?: string[];
  memoryEnabled?: boolean;
}

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

export const botsApi = {
  list: () => apiClient.get<BotListEntry[]>("/bots"),
  create: (input: BotInput) => apiClient.post<Bot>("/bots", input),
  get: (id: string) => apiClient.get<Bot>(`/bots/${id}`),
  update: (id: string, input: Partial<BotInput>) => apiClient.patch<Bot>(`/bots/${id}`, input),
  remove: (id: string) => apiClient.delete(`/bots/${id}`),
  models: () => apiClient.get<ModelsResponse>("/models"),
  send: (
    id: string,
    requestId: string,
    text: string,
    mentions?: string[],
    attachments?: string[],
  ) =>
    apiClient.post(`/bots/${id}/messages`, {
      requestId,
      text,
      ...(mentions?.length ? { mentions } : {}),
      ...(attachments?.length ? { attachments } : {}),
    }),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.postForm<{ ref: AttachmentRef }>("/uploads", form);
  },
  uploadUrl: (uploadId: string) => `/api/v1/uploads/${uploadId}/content`,
  deleteUpload: (uploadId: string) => apiClient.delete(`/uploads/${uploadId}`),
  abort: (id: string) => apiClient.post(`/bots/${id}/abort`),
  reset: (id: string) => apiClient.post<Bot>(`/bots/${id}/reset`),
  read: (id: string) => apiClient.post(`/bots/${id}/read`),
  pin: (id: string, pinned: boolean) => apiClient.post<Bot>(`/bots/${id}/pin`, { pinned }),
  capabilities: () => (capabilitiesCache ??= fetchCapabilities()),
  decideApproval: (
    id: string,
    taskId: number,
    decision: "approved" | "denied",
    alwaysAllow?: string,
  ) => apiClient.post(`/bots/${id}/approvals/${taskId}`, { decision, alwaysAllow }),
  browserStatus: (id: string) => apiClient.get<BrowserStatus>(`/bots/${id}/browser`),
  browserDriver: (id: string, driver: "agent" | "human") =>
    apiClient.post(`/bots/${id}/browser/driver`, { driver }),
  browserInput: (id: string, event: BrowserInputEvent) =>
    apiClient.post(`/bots/${id}/browser/input`, event),
  browserResetProfile: (id: string) => apiClient.delete(`/bots/${id}/browser/profile`),
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
  url: string | null;
  driver: "agent" | "human" | null;
}

/** Human input injected into the bot's browser (CDP peer channel). */
export type BrowserInputEvent =
  | { kind: "mouse"; x: number; y: number }
  | { kind: "scroll"; x: number; y: number; deltaY: number }
  | { kind: "key"; key: string; text?: string };
