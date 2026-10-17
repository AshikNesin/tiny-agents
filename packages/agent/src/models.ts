import type { Api, Model } from "@earendil-works/pi-ai";
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import { cloudflareAIGatewayProvider } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway";
import type { ModelInfo } from "./types";

/** The only inference provider tiny-agents uses (PRD §7.3). */
export const GATEWAY_PROVIDER = "cloudflare-ai-gateway";

export const GATEWAY_ENV_KEYS = [
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
] as const;

/** True when every Cloudflare AI Gateway setting is present. */
export function isGatewayConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return GATEWAY_ENV_KEYS.every((key) => (env[key] ?? "").trim() !== "");
}

/** pi-ai model registry with only the Cloudflare AI Gateway provider registered. */
export function createGatewayModels(): MutableModels {
  const models = createModels();
  models.setProvider(cloudflareAIGatewayProvider());
  return models;
}

function familyOf(model: Model<Api>): ModelInfo["family"] {
  if (model.id.startsWith("workers-ai/")) return "workers-ai";
  if (model.api === "anthropic-messages") return "anthropic";
  if (model.api === "openai-responses" || model.api === "openai-completions") return "openai";
  return "other";
}

export function toModelInfo(model: Model<Api>): ModelInfo {
  return {
    id: model.id,
    name: model.name,
    family: familyOf(model),
    reasoning: Boolean(model.reasoning),
    contextWindow: model.contextWindow,
  };
}
