/**
 * Typed client for Settings → Models (issue #179). Creating an account,
 * changing its connection and deleting it carry the vault's step-up token;
 * the caller runs them through `useStepUp().run`. Nothing here receives a key.
 */
import { apiClient } from "@groot/shell/lib/api";
import type { ProviderKind } from "@tiny-agents/models";
import { stepped } from "./vault-api";

export type { ProviderKind };

export type ModelRole = "bot_default" | "memory_capture" | "chat_title" | "vision" | "classifier";

export interface Overrides {
  contextWindow?: number;
  maxOutputTokens?: number;
  imageInput?: boolean;
  reasoning?: boolean;
}

export interface AccountModel {
  id: string;
  upstreamId: string;
  name: string;
  type: "chat" | "classifier";
  source: "discovered" | "manual";
  enabled: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  imageInput: boolean;
  reasoning: boolean;
  overrides: Overrides;
  compat: Record<string, unknown> | null;
  missing: boolean;
  /** Bots that run on it. */
  usedBy: number;
}

export interface Account {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string | null;
  viaProviderId: string | null;
  settings: Record<string, unknown>;
  discovery: "auto" | "manual";
  allowPrivateNetwork: boolean;
  enabled: boolean;
  status: "ok" | "unchecked" | "key_rejected" | "unreachable" | "locked";
  statusDetail: string | null;
  checkedAt: string | null;
  version: number;
  credential: { hint: string | null; backend: string } | null;
  models: AccountModel[];
}

export interface ProviderTemplate {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string | null;
  aggregator?: boolean;
  keyless?: boolean;
  privateNetwork?: boolean;
}

export interface DiscoveredModel {
  upstreamId: string;
  name: string;
  type: "chat" | "classifier";
  contextWindow: number;
  maxOutputTokens: number;
  imageInput: boolean;
  reasoning: boolean;
  known: boolean;
}

export interface Connection {
  kind: Exclude<ProviderKind, "faux">;
  baseUrl?: string | null;
  apiKey?: string;
  settings?: {
    accountId?: string;
    gatewayId?: string;
    /** Providers configured in the gateway itself (BYOK custom providers). */
    customProviders?: { slug: string; basePath?: string }[];
  };
  allowPrivateNetwork?: boolean;
  viaProviderId?: string | null;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export type Roles = Record<ModelRole, { modelId: string | null; fallback: boolean }>;

export const modelsApi = {
  accounts: () =>
    apiClient.get<{ accounts: Account[]; templates: ProviderTemplate[] }>("/models/providers"),
  discover: (connection: Connection) =>
    apiClient.post<{ models: DiscoveredModel[] }>("/models/discover", connection),
  create: (
    input: Connection & {
      name?: string;
      discovery: "auto" | "manual";
      models?: string[];
      model?: { upstreamId: string; name?: string; overrides?: Overrides };
    },
  ) => stepped<Account>("post", "/models/providers", input),
  patch: (
    account: Account,
    input: {
      name?: string;
      enabled?: boolean;
      fallbackModelId?: string | null;
      maxTurns?: number | "unlimited" | null;
    },
  ) =>
    apiClient.request<Account>("patch", `/models/providers/${account.id}`, {
      body: input,
      headers: { "If-Match": String(account.version) },
    }),
  updateConnection: (id: string, input: Omit<Connection, "kind" | "viaProviderId">) =>
    stepped<Account>("put", `/models/providers/${id}/connection`, input),
  /** The models the account's endpoint lists that it doesn't have yet. */
  available: (id: string) =>
    apiClient.get<{ models: DiscoveredModel[] }>(`/models/providers/${id}/available`),
  refresh: (id: string) =>
    apiClient.post<{ account: Account; available: DiscoveredModel[] }>(
      `/models/providers/${id}/refresh`,
    ),
  remove: (id: string, moveTo?: string) =>
    stepped<{ deleted: boolean }>(
      "delete",
      `/models/providers/${id}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ""}`,
    ),
  addModel: (
    accountId: string,
    input: { upstreamId: string; name?: string; overrides?: Overrides },
  ) => apiClient.post<AccountModel>(`/models/providers/${accountId}/models`, input),
  patchModel: (id: string, input: { name?: string; enabled?: boolean; overrides?: Overrides }) =>
    apiClient.request<AccountModel>("patch", `/models/${id}`, { body: input }),
  removeModel: (id: string, moveTo?: string) =>
    apiClient.request<{ deleted: boolean }>(
      "delete",
      `/models/${id}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ""}`,
      { emptyOk: true },
    ),
  test: (input: { modelId: string } | (Connection & { upstreamId: string; image?: boolean })) =>
    apiClient.post<TestResult>("/models/test", input),
  roles: () => apiClient.get<{ roles: Roles }>("/models/roles"),
  setRoles: (input: Partial<Record<ModelRole, string | null>>) =>
    apiClient.request<{ roles: Roles }>("put", "/models/roles", { body: input }),
};
