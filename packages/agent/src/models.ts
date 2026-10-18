import type { Api, Model } from "@earendil-works/pi-ai";
import { createModels, createProvider, type MutableModels } from "@earendil-works/pi-ai/models";
import { cloudflareAIGatewayProvider } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
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
  registerGatewayCustomProviders(models);
  return models;
}

/**
 * Custom (BYOK) providers configured on the gateway, registered as first-class
 * pi-ai providers so bots can use them like catalog models. Driven by
 * GATEWAY_CUSTOM_PROVIDERS (JSON array):
 *
 *   [{ "id": "custom-zai-coding-plan", "models": [{ "id": "glm-5.3-flash",
 *      "name": "GLM 5.3 Flash", "contextWindow": 131072, "reasoning": true }] }]
 *
 * Each model is an OpenAI-compatible chat model routed through
 * https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/<provider-id>,
 * authenticated with the gateway's own key (CLOUDFLARE_API_KEY) — the
 * provider's upstream key lives in the gateway, never here.
 */
function gatewayBearerAuth() {
  return {
    name: "Cloudflare AI Gateway token",
    resolve: async (input: {
      ctx: { env(name: string, opts?: { signal?: AbortSignal }): Promise<string | undefined> };
      signal: AbortSignal;
    }) => {
      const key = await input.ctx.env("CLOUDFLARE_API_KEY", { signal: input.signal });
      if (!key) return undefined;
      return { auth: { apiKey: key }, source: "CLOUDFLARE_API_KEY" };
    },
  };
}

export function registerGatewayCustomProviders(
  models: MutableModels,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const raw = env.GATEWAY_CUSTOM_PROVIDERS?.trim();
  if (!raw) return;
  let providers: unknown;
  try {
    providers = JSON.parse(raw);
  } catch {
    // A malformed list must not take the server down; the gateway catalog
    // alone still works.
    return;
  }
  if (!Array.isArray(providers)) return;
  const account = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const gateway = env.CLOUDFLARE_GATEWAY_ID?.trim();
  if (!account || !gateway) return;
  // Optional alternate gateway front door (e.g. an exe.dev http-proxy like
  // https://cf-tiny-agents.int.exe.xyz that injects the Cloudflare token, so
  // no key ever reaches this machine). Defaults to the real gateway host.
  const frontDoor =
    env.GATEWAY_BASE_URL?.trim().replace(/\/+$/, "") ?? "https://gateway.ai.cloudflare.com";

  for (const entry of providers) {
    if (typeof entry !== "object" || entry === null) continue;
    const provider = entry as {
      id?: unknown;
      name?: unknown;
      basePath?: unknown;
      models?: unknown;
    };
    if (typeof provider.id !== "string" || !Array.isArray(provider.models)) continue;
    // A custom provider may mount its upstream under a base path (e.g. Z.AI's
    // coding plan lives at /api/coding/paas/v4); the gateway URL includes it.
    const basePath =
      typeof provider.basePath === "string" ? provider.basePath.replace(/^\/+|\/+$/g, "") : "";
    const prefix = [frontDoor, "v1", account, gateway, provider.id, basePath]
      .filter(Boolean)
      .join("/");
    interface CustomModelSpec {
      id: string;
      name: string;
      api: "openai-completions";
      baseUrl: string;
      contextWindow: number;
      maxTokens: number;
      reasoning: boolean;
      input: ["text"];
      cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
      provider: string;
      headers?: Record<string, string>;
      compat?: Record<string, unknown>;
    }
    const list: CustomModelSpec[] = [];
    for (const model of provider.models) {
      if (typeof model !== "object" || model === null) continue;
      const m = model as Record<string, unknown>;
      if (typeof m.id !== "string") continue;
      list.push({
        id: m.id,
        name: typeof m.name === "string" ? m.name : m.id,
        api: "openai-completions",
        baseUrl: prefix,
        // A bearer placeholder the front-door proxy overwrites with the real
        // gateway token; suppresses pi-ai's cf-aig-authorization header (the
        // gateway would otherwise see the placeholder there and 401).
        headers: { authorization: "Bearer unused" },
        contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : 131_072,
        maxTokens: typeof m.maxTokens === "number" ? m.maxTokens : 16_384,
        reasoning: m.reasoning === true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        provider: provider.id,
        // Z.AI (GLM) quirks: no "developer" role (system only), max_tokens
        // field, reasoning flows through reasoning_content, no effort knob.
        ...(provider.id.includes("zai")
          ? {
              compat: {
                supportsDeveloperRole: false,
                supportsStore: false,
                supportsReasoningEffort: false,
                supportsUsageInStreaming: true,
                supportsFinishReason: true,
                maxTokensField: "max_tokens",
                requiresToolResultName: false,
                requiresAssistantAfterToolResult: false,
                requiresThinkingAsText: false,
                requiresReasoningContentOnAssistantMessages: true,
                thinkingFormat: "zai",
              },
            }
          : {}),
      });
    }
    if (list.length === 0) continue;

    models.setProvider(
      createProvider({
        id: provider.id,
        name: typeof provider.name === "string" ? provider.name : provider.id,
        baseUrl: prefix,
        // Same credential semantics as the gateway itself: the gateway key
        // authorizes; upstream keys are injected by the gateway (BYOK).
        // Plain bearer auth (standard Authorization header, no gateway-specific
        // cf-aig-authorization): a front-door proxy (GATEWAY_BASE_URL) replaces
        // the header with the real token; calling the gateway host directly
        // uses CLOUDFLARE_API_KEY as the bearer.
        auth: { apiKey: gatewayBearerAuth() },
        models: list,
        api: openAICompletionsApi(),
      }),
    );
  }
}

function familyOf(model: Model<Api>, providerId?: string): ModelInfo["family"] {
  if (providerId?.startsWith("custom-")) return "other";
  if (model.id.startsWith("workers-ai/")) return "workers-ai";
  if (model.api === "anthropic-messages") return "anthropic";
  if (model.api === "openai-responses" || model.api === "openai-completions") return "openai";
  return "other";
}

export function toModelInfo(model: Model<Api>, providerTag?: string): ModelInfo {
  return {
    id: providerTag ? `${providerTag}/${model.id}` : model.id,
    name: model.name,
    family: familyOf(model, providerTag),
    reasoning: Boolean(model.reasoning),
    contextWindow: model.contextWindow,
  };
}
