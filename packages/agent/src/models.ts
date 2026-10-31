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

/**
 * Strip the literal quotes container UIs (Coolify, docker-compose editors)
 * leave around values: '"https://x"' is a string containing quotes, not a
 * quoted string. Also drops incidental whitespace. Keeps inner quotes intact.
 */
function unquote(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return trimmed || undefined;
  const match = trimmed.match(/^(['"])([\s\S]*)\1$/);
  return match ? match[2].trim() : trimmed;
}

/** True when every Cloudflare AI Gateway setting is present. */
export function isGatewayConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return GATEWAY_ENV_KEYS.every((key) => (env[key] ?? "").trim() !== "");
}

/** pi-ai model registry with only the Cloudflare AI Gateway provider registered. */
export function createGatewayModels(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MutableModels {
  const models = createModels();
  models.setProvider(cloudflareAIGatewayProvider());
  registerGatewayCustomProviders(models, env);
  return models;
}

/** Custom gateway models known to accept images even without `vision: true`. */
const DEFAULT_VISION_MODEL_IDS = new Set(["glm-5.3-flash"]);

/**
 * Custom (BYOK) providers configured on the gateway, registered as first-class
 * pi-ai providers so bots can use them like catalog models. Driven by
 * GATEWAY_CUSTOM_PROVIDERS (JSON array):
 *
 *   [{ "id": "custom-zai-coding-plan", "models": [{ "id": "glm-5.3-flash",
 *      "name": "GLM 5.3 Flash", "contextWindow": 131072, "reasoning": true,
 *      "vision": true }] }]
 *
 * Each model is an OpenAI-compatible chat model routed through
 * https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/<provider-id>,
 * authenticated with the gateway's own key (CLOUDFLARE_API_KEY) — the
 * provider's upstream key lives in the gateway, never here.
 */
/**
 * Auth for custom gateway providers.
 *
 * Direct calls (gateway.ai.cloudflare.com) use the gateway's native scheme —
 * `cf-aig-authorization: Bearer <CLOUDFLARE_API_KEY>` with `Authorization`
 * explicitly nulled — matching pi-ai's built-in cloudflare-ai-gateway
 * provider (which is what the gateway expects; a plain bearer in
 * `Authorization` gets 401 code 2009).
 *
 * Behind an alternate front door (GATEWAY_BASE_URL, e.g. the exe.dev proxy
 * that injects the real token) the placeholder bearer rides in
 * `Authorization` instead: the model's static header set already carries
 * `authorization: Bearer unused` to satisfy pi-ai's key check, and the proxy
 * swaps it for the real gateway token in flight.
 */
function gatewayCustomAuth(useNativeHeader: boolean) {
  return {
    name: "Cloudflare AI Gateway token",
    resolve: async (input: {
      ctx: { env(name: string, opts?: { signal?: AbortSignal }): Promise<string | undefined> };
      signal: AbortSignal;
    }) => {
      const key = await input.ctx.env("CLOUDFLARE_API_KEY", { signal: input.signal });
      if (!key) return undefined;
      if (!useNativeHeader) return { auth: { apiKey: key }, source: "CLOUDFLARE_API_KEY" };
      return {
        auth: {
          headers: {
            "cf-aig-authorization": `Bearer ${key}`,
            Authorization: null,
            "x-api-key": null,
          },
        },
        source: "CLOUDFLARE_API_KEY",
      };
    },
  };
}

export function registerGatewayCustomProviders(
  models: MutableModels,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  let raw = unquote(env.GATEWAY_CUSTOM_PROVIDERS);
  if (!raw) return;
  // One extra tolerance pass: quote-wrapped JSON the container UI kept whole
  // ('[{"id":...}]' as a single quoted value) parses after unquoting above;
  // anything else malformed must not take the server down — the gateway
  // catalog alone still works — but say so instead of silently vanishing.
  let providers: unknown;
  try {
    providers = JSON.parse(raw);
  } catch {
    console.warn(
      "[tiny-agents] GATEWAY_CUSTOM_PROVIDERS is not valid JSON — custom models are NOT registered. " +
        "Check for quote mangling in the container environment.",
    );
    return;
  }
  if (!Array.isArray(providers)) return;
  const account = unquote(env.CLOUDFLARE_ACCOUNT_ID);
  const gateway = unquote(env.CLOUDFLARE_GATEWAY_ID);
  if (!account || !gateway) {
    console.warn(
      "[tiny-agents] CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_GATEWAY_ID missing — custom models are NOT registered.",
    );
    return;
  }
  if (!account || !gateway) return;
  // Optional alternate gateway front door (e.g. an exe.dev http-proxy like
  // https://cf-tiny-agents.int.exe.xyz that injects the Cloudflare token, so
  // no key ever reaches this machine). Defaults to the real gateway host.
  const frontDoorRaw = unquote(env.GATEWAY_BASE_URL)?.replace(/\/+$/, "");
  let frontDoor = "https://gateway.ai.cloudflare.com";
  if (frontDoorRaw) {
    try {
      frontDoor = new URL(frontDoorRaw).toString().replace(/\/+$/, "");
    } catch {
      console.warn(
        `[tiny-agents] GATEWAY_BASE_URL "${frontDoorRaw}" is not a valid URL — using https://gateway.ai.cloudflare.com instead.`,
      );
    }
  }

  for (const entry of providers) {
    if (typeof entry !== "object" || entry === null) continue;
    const provider = entry as {
      id?: unknown;
      name?: unknown;
      basePath?: unknown;
      models?: unknown;
    };
    const providerId = typeof provider.id === "string" ? unquote(provider.id) : undefined;
    if (!providerId || !Array.isArray(provider.models)) continue;
    // A custom provider may mount its upstream under a base path (e.g. Z.AI's
    // coding plan lives at /api/coding/paas/v4); the gateway URL includes it.
    const basePath =
      typeof provider.basePath === "string"
        ? (unquote(provider.basePath)?.replace(/^\/+|\/+$/g, "") ?? "")
        : "";
    const prefix = [frontDoor, "v1", account, gateway, providerId, basePath]
      .filter(Boolean)
      .join("/");
    // The OpenAI SDK runs new URL(baseUrl) at send time; a bad part here
    // would surface as a cryptic "Invalid URL" mid-chat. Catch it at boot.
    try {
      new URL(prefix);
    } catch {
      console.warn(
        `[tiny-agents] custom provider "${providerId}" produced an invalid URL (${prefix}) — skipped.`,
      );
      continue;
    }
    // Direct-to-gateway calls speak the gateway's native cf-aig scheme; any
    // GATEWAY_BASE_URL front door gets the placeholder bearer the proxy
    // replaces with the real token.
    const nativeGatewayAuth = frontDoor === "https://gateway.ai.cloudflare.com";
    interface CustomModelSpec {
      id: string;
      name: string;
      api: "openai-completions";
      baseUrl: string;
      contextWindow: number;
      maxTokens: number;
      reasoning: boolean;
      input: ["text"] | ["text", "image"];
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
        // Behind a front-door proxy: a bearer placeholder the proxy overwrites
        // with the real gateway token. Direct-to-gateway: none — the native
        // cf-aig-authorization header (from the auth resolver) carries the key.
        ...(nativeGatewayAuth ? {} : { headers: { authorization: "Bearer unused" } }),
        contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : 131_072,
        maxTokens: typeof m.maxTokens === "number" ? m.maxTokens : 16_384,
        reasoning: m.reasoning === true,
        // Declaring image input is what keeps pi-ai from stripping image
        // blocks (downgradeUnsupportedImages) before the wire. `vision: true`
        // opts in per model; glm-5.3-flash defaults to it (the owner's
        // vision side-call model, confirmed image-capable).
        input:
          m.vision === true || (m.vision !== false && DEFAULT_VISION_MODEL_IDS.has(m.id))
            ? (["text", "image"] as const)
            : (["text"] as const),
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        provider: providerId,
        // Z.AI (GLM) quirks: no "developer" role (system only), max_tokens
        // field, reasoning flows through reasoning_content, no effort knob.
        ...(providerId.includes("zai")
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
        id: providerId,
        name:
          typeof provider.name === "string" ? (unquote(provider.name) ?? providerId) : providerId,
        baseUrl: prefix,
        auth: { apiKey: gatewayCustomAuth(nativeGatewayAuth) },
        models: list,
        api: openAICompletionsApi(),
      }),
    );
  }
}

/** `providerTag` is the "custom:<provider>" prefix a custom-provider model id carries. */
function familyOf(model: Model<Api>, providerTag?: string): ModelInfo["family"] {
  if (providerTag?.startsWith("custom:")) return "other";
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
    vision: (model.input ?? []).includes("image"),
  };
}
