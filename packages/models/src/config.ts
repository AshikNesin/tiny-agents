import type { ModelRole, ProviderKind, ProviderStatus } from "./types";

export interface ProviderAccount {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string | null;
  hasCredential: boolean;
  viaProviderId: string | null;
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
  compat: Record<string, unknown> | null;
  missing: boolean;
}

export interface ModelConfig {
  providers: readonly ProviderAccount[];
  models: readonly ModelRow[];
  roles: Readonly<Partial<Record<ModelRole, string>>>;
}

export interface CredentialResolver {
  resolve(providerId: string, signal?: AbortSignal): Promise<string | undefined>;
}

export const EMPTY_MODEL_CONFIG: ModelConfig = { providers: [], models: [], roles: {} };
