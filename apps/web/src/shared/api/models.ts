/**
 * The Models API's wire types: Settings → Models (`server/api/models`, issue
 * #179), and the chat model picker (`GET /models`). Naming in `./common.ts`.
 * No response carries a key.
 */
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

/** `GET /models`: what New bot and the bot editor pick from. */
export interface ModelsResponse {
  /** Chat models, picker order; unavailable ones carry the reason. */
  models: CatalogModel[];
  /** The `bot_default` role's model, pre-selected in New bot. */
  defaultModelId: string | null;
  /** Some chat model can run now. */
  canAnswer: boolean;
  providers: ProviderSummary[];
}

export type ModelRole = "bot_default" | "memory_capture" | "chat_title" | "vision" | "classifier";

/** Capability overrides: a key present wins over the catalog. */
export interface Overrides {
  contextWindow?: number;
  maxOutputTokens?: number;
  imageInput?: boolean;
  reasoning?: boolean;
}

/** A model under an account (`models.service.ts` `modelView`). */
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

/** A provider account (`models.service.ts` `accountView`). */
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

/** `GET /models/providers`. */
export interface AccountListData {
  accounts: AccountData[];
  templates: readonly ProviderTemplate[];
}

export type AccountList = Jsonified<AccountListData>;

/** `POST /models/discover` and `GET /models/providers/:id/available`. */
export interface DiscoveredModels {
  models: DiscoveredModel[];
}

/** `POST /models/providers/:id/refresh`. */
export interface AccountRefreshData {
  account: AccountData;
  available: DiscoveredModel[];
}

export type AccountRefresh = Jsonified<AccountRefreshData>;

/** `POST /models/test`. */
export type ModelTestResult = TestResult;

/** What a role resolves to; `fallback`: the role is unset and uses its documented fallback. */
export type Roles = Record<ModelRole, { modelId: string | null; fallback: boolean }>;

/** `GET /models/roles` and `PUT /models/roles`. */
export interface RolesResponse {
  roles: Roles;
}

/** An endpoint to reach: what discovery, Test and a new account start from. */
export interface ModelEndpoint {
  kind: Exclude<ProviderKind, "faux">;
  baseUrl?: string | null;
  apiKey?: string;
  settings?: {
    accountId?: string;
    gatewayId?: string;
    upstream?: string;
    basePath?: string;
    /** Providers configured in the gateway itself (BYOK custom providers). */
    customProviders?: { slug: string; basePath?: string }[];
    fallbackModelId?: string | null;
    maxTurns?: number | "unlimited" | null;
  };
  allowPrivateNetwork?: boolean;
  /** An OpenAI Chat account routed through this gateway account. */
  viaProviderId?: string | null;
}

/** One model to add by hand. */
export interface ModelAddBody {
  upstreamId: string;
  name?: string;
  overrides?: Overrides;
  compat?: Record<string, unknown> | null;
}

/** `POST /models/providers` (step-up). */
export type AccountCreateBody = ModelEndpoint & {
  name?: string;
  /** auto: models come from discovery; manual: the "single model" tab adds one. */
  discovery?: "auto" | "manual";
  /** auto: the upstream ids to add (enabled). */
  models?: string[];
  /** manual: the one model to add. */
  model?: ModelAddBody;
};

/** `PATCH /models/providers/:id` (with `If-Match: <version>`). */
export interface AccountPatchBody {
  name?: string;
  enabled?: boolean;
  /** Claude plan only: the model a turn moves to when the plan is off or unreachable. */
  fallbackModelId?: string | null;
  /** Claude plan only: null goes back to the worker's default. */
  maxTurns?: number | "unlimited" | null;
}

/** `PUT /models/providers/:id/connection` (step-up): blank `apiKey` keeps the saved key. */
export type AccountConnectionBody = Omit<ModelEndpoint, "kind" | "viaProviderId">;

/** `PATCH /models/:id`. */
export interface ModelPatchBody {
  name?: string;
  enabled?: boolean;
  overrides?: Overrides;
  compat?: Record<string, unknown> | null;
}

/** `POST /models/test`: a saved model, or an unsaved one at an endpoint. */
export type ModelTestBody =
  | { modelId: string }
  | (ModelEndpoint & { upstreamId: string; image?: boolean });

/** `PUT /models/roles`: null clears a role. */
export type RolesBody = Partial<Record<ModelRole, string | null>>;
