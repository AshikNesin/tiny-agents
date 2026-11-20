export interface CatalogModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  providerKind: ProviderKind;
  upstreamId: string;
  type: "chat" | "classifier";
  engine: AgentEngineKind;
  contextWindow: number;
  maxOutputTokens: number;
  vision: boolean;
  reasoning: boolean;
  enabled: boolean;
  available: boolean;
  unavailableReason?: ModelUnavailableReason;
  note?: string;
}

export type ModelUnavailableReason = "disabled" | "locked" | "missing" | "provider_failing";

export type ProviderKind =
  | "anthropic"
  | "openai-chat"
  | "openai-responses"
  | "gemini"
  | "cloudflare-ai-gateway"
  | "claude-plan"
  | "faux";

export type ProviderStatus = "ok" | "unchecked" | "key_rejected" | "unreachable" | "locked";

export interface ProviderSummary {
  id: string;
  name: string;
  kind: ProviderKind;
  status: ProviderStatus;
  statusDetail?: string;
  enabled: boolean;
  modelCount: number;
}

export type ModelRole = "bot_default" | "memory_capture" | "chat_title" | "vision" | "classifier";

export interface ModelRoute {
  engine: AgentEngineKind;
  providerId: string;
  upstreamId: string;
}

export type AgentEngineKind = "pi" | "claude-code";
