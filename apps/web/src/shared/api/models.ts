import type {
  CatalogModel,
  DiscoveredModel,
  ProviderKind,
  ProviderSummary,
  ProviderTemplate,
  TestResult,
} from "@tiny-agents/models";
import type { Jsonified } from "../json";

export type { CatalogModel, DiscoveredModel, ProviderKind, ProviderSummary, ProviderTemplate };

export interface ModelsResponse {
  models: CatalogModel[];
  defaultModelId: string | null;
  canAnswer: boolean;
  providers: ProviderSummary[];
}

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
  usedBy: number;
}

export interface AccountData {
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
  checkedAt: Date | null;
  version: number;
  credential: { hint: string | null; backend: string } | null;
  models: AccountModel[];
}

export type Account = Jsonified<AccountData>;

export interface AccountListData {
  accounts: AccountData[];
  templates: readonly ProviderTemplate[];
}

export type AccountList = Jsonified<AccountListData>;

export interface DiscoveredModels {
  models: DiscoveredModel[];
}

export interface AccountRefreshData {
  account: AccountData;
  available: DiscoveredModel[];
}

export type AccountRefresh = Jsonified<AccountRefreshData>;

export type ModelTestResult = TestResult;

export type Roles = Record<ModelRole, { modelId: string | null; fallback: boolean }>;

export interface RolesResponse {
  roles: Roles;
}

export interface ModelEndpoint {
  kind: Exclude<ProviderKind, "faux">;
  baseUrl?: string | null;
  apiKey?: string;
  settings?: {
    accountId?: string;
    gatewayId?: string;
    upstream?: string;
    basePath?: string;
    customProviders?: { slug: string; basePath?: string }[];
    fallbackModelId?: string | null;
    maxTurns?: number | "unlimited" | null;
  };
  allowPrivateNetwork?: boolean;
  viaProviderId?: string | null;
}

export interface ModelAddBody {
  upstreamId: string;
  name?: string;
  overrides?: Overrides;
  compat?: Record<string, unknown> | null;
}

export type AccountCreateBody = ModelEndpoint & {
  name?: string;
  discovery?: "auto" | "manual";
  models?: string[];
  model?: ModelAddBody;
};

export interface AccountPatchBody {
  name?: string;
  enabled?: boolean;
  fallbackModelId?: string | null;
  maxTurns?: number | "unlimited" | null;
}

export type AccountConnectionBody = Omit<ModelEndpoint, "kind" | "viaProviderId">;

export interface ModelPatchBody {
  name?: string;
  enabled?: boolean;
  overrides?: Overrides;
  compat?: Record<string, unknown> | null;
}

export type ModelTestBody =
  | { modelId: string }
  | (ModelEndpoint & { upstreamId: string; image?: boolean });

export type RolesBody = Partial<Record<ModelRole, string | null>>;
