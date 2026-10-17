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
}

export interface ModelsResponse {
  models: ModelInfo[];
  defaultModel?: string;
  gatewayConfigured: boolean;
}

export interface BotListEntry {
  id: string;
  name: string;
  description: string;
  modelId: string;
  avatarEmoji: string | null;
  avatarColor: string;
  lastMessagePreview: string | null;
  lastActivityAt: string;
  unread: boolean;
  replying: boolean;
}

export interface Bot {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string;
  avatarEmoji: string | null;
  avatarColor: string;
  conversationId: string;
  lastReadAt: string | null;
  lastActivityAt: string;
  lastMessagePreview: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BotInput {
  name: string;
  description?: string;
  systemPrompt?: string;
  modelId: string;
  avatarEmoji?: string;
  avatarColor?: string;
}

export const botsApi = {
  list: () => apiClient.get<BotListEntry[]>("/bots"),
  create: (input: BotInput) => apiClient.post<Bot>("/bots", input),
  get: (id: string) => apiClient.get<Bot>(`/bots/${id}`),
  update: (
    id: string,
    input: Partial<Omit<BotInput, "avatarEmoji">> & { avatarEmoji?: string | null },
  ) => apiClient.patch<Bot>(`/bots/${id}`, input),
  remove: (id: string) => apiClient.delete(`/bots/${id}`),
  models: () => apiClient.get<ModelsResponse>("/models"),
  send: (id: string, requestId: string, text: string) =>
    apiClient.post(`/bots/${id}/messages`, { requestId, text }),
  abort: (id: string) => apiClient.post(`/bots/${id}/abort`),
  reset: (id: string) => apiClient.post<Bot>(`/bots/${id}/reset`),
  read: (id: string) => apiClient.post(`/bots/${id}/read`),
};
