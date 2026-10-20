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
}

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
  capabilities: () => (capabilitiesCache ??= fetchCapabilities()),
  decideApproval: (
    id: string,
    taskId: number,
    decision: "approved" | "denied",
    alwaysAllow?: string,
  ) => apiClient.post(`/bots/${id}/approvals/${taskId}`, { decision, alwaysAllow }),
};
