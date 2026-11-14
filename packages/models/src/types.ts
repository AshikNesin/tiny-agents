/**
 * The model types the app and the runtime share: a model row as the app shows
 * it, provider kinds and statuses, model roles and routes. Nothing here
 * references pi-durable or `@tiny-agents/agent`.
 */

/**
 * A model as the app shows and picks it (issue #179): a row the owner created
 * or discovered under a provider account. `id` is the row id, the only thing
 * a bot stores; nobody reads or types it.
 */
export interface CatalogModel {
  id: string;
  /** Display name ("Claude Sonnet 4.6"). */
  name: string;
  providerId: string;
  /** The account's owner-chosen name ("Anthropic · Work"). */
  providerName: string;
  providerKind: ProviderKind;
  /** Wire id ("claude-sonnet-4-6"). */
  upstreamId: string;
  type: "chat" | "classifier";
  engine: AgentEngineKind;
  contextWindow: number;
  maxOutputTokens: number;
  /** The model accepts image content. */
  vision: boolean;
  reasoning: boolean;
  /** Offered in the picker. */
  enabled: boolean;
  /** It can run now: its account is enabled and readable and the model is still listed. */
  available: boolean;
  unavailableReason?: ModelUnavailableReason;
  /** Short picker note, e.g. "uses your Claude plan". */
  note?: string;
}

export type ModelUnavailableReason = "disabled" | "locked" | "missing" | "provider_failing";

/** How a provider account is reached; fixes the wire API, the auth header and the engine. */
export type ProviderKind =
  | "anthropic"
  | "openai-chat"
  | "openai-responses"
  | "gemini"
  | "cloudflare-ai-gateway"
  | "claude-plan"
  | "faux";

export type ProviderStatus = "ok" | "unchecked" | "key_rejected" | "unreachable" | "locked";

/** A provider account as the app lists it. No secret, ever. */
export interface ProviderSummary {
  id: string;
  name: string;
  kind: ProviderKind;
  status: ProviderStatus;
  statusDetail?: string;
  enabled: boolean;
  modelCount: number;
}

/** A named slot a feature reads its model from. */
export type ModelRole = "bot_default" | "memory_capture" | "chat_title" | "vision" | "classifier";

/** What the runtime needs to call a model. Only the catalog builds one. */
export interface ModelRoute {
  engine: AgentEngineKind;
  /** The pi-ai provider id: the account's row id. */
  providerId: string;
  upstreamId: string;
}

export type AgentEngineKind = "pi" | "claude-code";
