/**
 * The model configuration the app hands the runtime (issue #179): provider
 * accounts, their model rows and the role assignments, as plain data. The
 * app reads it from its database; this package never reads a database or
 * env for models. Credentials are not in it: the runtime asks the
 * `CredentialResolver` per request.
 */
import type { ModelRole, ProviderKind, ProviderStatus } from "./types";

export interface ProviderAccount {
  /** Row id; also the pi-ai provider id. */
  id: string;
  name: string;
  kind: ProviderKind;
  /** Canonical base URL; null for kinds that derive it (claude-plan, faux, gateway routes). */
  baseUrl: string | null;
  /** A key is stored for it (resolved per request through the resolver). */
  hasCredential: boolean;
  /** Gateway route: the cloudflare-ai-gateway account this one goes through. */
  viaProviderId: string | null;
  /**
   * Kind-specific, non-secret settings:
   * - cloudflare-ai-gateway: `{ accountId, gatewayId }`
   * - gateway route: `{ upstream, basePath? }`
   * - claude-plan: `{ fallbackModelId?, maxTurns? }` (`maxTurns`: a number or `"unlimited"`)
   */
  settings: Record<string, unknown>;
  enabled: boolean;
  status: ProviderStatus;
  statusDetail: string | null;
}

export interface ModelRow {
  id: string;
  providerId: string;
  upstreamId: string;
  name: string;
  type: "chat" | "classifier";
  enabled: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  imageInput: boolean;
  reasoning: boolean;
  /** pi-ai compat flags (e.g. Z.AI's no-developer-role), or null. */
  compat: Record<string, unknown> | null;
  /** The upstream stopped listing it; kept so references stay valid. */
  missing: boolean;
}

export interface ModelConfig {
  providers: readonly ProviderAccount[];
  models: readonly ModelRow[];
  roles: Readonly<Partial<Record<ModelRole, string>>>;
}

/** Resolves a provider account's key at request time (the app's vault). */
export interface CredentialResolver {
  /** The key, or undefined when the account has none or it can't be read. */
  resolve(providerId: string, signal?: AbortSignal): Promise<string | undefined>;
}

export const EMPTY_MODEL_CONFIG: ModelConfig = { providers: [], models: [], roles: {} };
