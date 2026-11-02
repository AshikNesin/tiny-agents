import type { Api, Model } from "@earendil-works/pi-ai";
import {
  createModels,
  createProvider,
  type Models,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai/models";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ModelInfo } from "./types";

/** The default inference provider (PRD §7.3): Cloudflare AI Gateway. */
export const GATEWAY_PROVIDER = "cloudflare-ai-gateway";

export const GATEWAY_ENV_KEYS = [
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
] as const;

/**
 * The env vars a built-in provider reads its key from, for setup hints.
 * pi-ai does not expose them, so this covers the common providers; any
 * other provider's hint names it without variables.
 */
const PROVIDER_ENV_HINTS: Readonly<Record<string, readonly string[]>> = {
  [GATEWAY_PROVIDER]: GATEWAY_ENV_KEYS,
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GEMINI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  xai: ["XAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  "vercel-ai-gateway": ["AI_GATEWAY_API_KEY"],
};

/** One configured provider's state, for the models endpoint and the setup banner. */
export interface ProviderStatus {
  id: string;
  name: string;
  /** Its auth resolves (key and any account settings present). */
  configured: boolean;
  /** What to set to configure it. */
  setupHint: string;
}

/** A setup hint for one provider: the env vars to set, when known. */
export function providerSetupHint(providerId: string, name = providerId): string {
  const keys = PROVIDER_ENV_HINTS[providerId];
  return keys?.length
    ? `Set ${formatList(keys)} for ${name}, then restart.`
    : `Configure ${name} credentials (see pi-ai's provider docs), then restart.`;
}

function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

let builtinIds: ReadonlySet<string> | undefined;
const warned = new Set<string>();

/** Warn once per message: AI_PROVIDERS is parsed at boot and again per runtime. */
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/** Ids of every provider pi-ai ships (openai, anthropic, cloudflare-ai-gateway, ...). */
export function builtinProviderIds(): ReadonlySet<string> {
  builtinIds ??= new Set(builtinProviders().map((provider) => provider.id));
  return builtinIds;
}

/**
 * The inference providers this deployment uses, from AI_PROVIDERS: a
 * comma-separated list of pi-ai built-in provider ids, in order. The first
 * is the primary provider: its models keep bare ids (`gpt-5`); the others'
 * models are namespaced `custom:<provider>/<model>`. Unknown ids are dropped
 * with a warning. Unset or empty: the Cloudflare AI Gateway alone.
 *
 *   AI_PROVIDERS=openai                         # OpenAI direct only
 *   AI_PROVIDERS=cloudflare-ai-gateway,openai   # both; gateway ids stay bare
 */
export function aiProviderIds(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const raw = unquote(env.AI_PROVIDERS);
  if (!raw) return [GATEWAY_PROVIDER];
  const known = builtinProviderIds();
  // A Set keeps first-seen order and drops repeats.
  const ids = new Set<string>();
  for (const part of raw.split(",")) {
    const id = unquote(part)?.toLowerCase();
    if (!id || ids.has(id)) continue;
    if (!known.has(id)) {
      warnOnce(
        `[tiny-agents] AI_PROVIDERS names "${id}", which is not a pi-ai provider — ignored. ` +
          `Known: ${[...known].sort().join(", ")}.`,
      );
      continue;
    }
    ids.add(id);
  }
  if (ids.size === 0) {
    warnOnce(
      `[tiny-agents] AI_PROVIDERS has no known provider — using ${GATEWAY_PROVIDER} instead.`,
    );
    return [GATEWAY_PROVIDER];
  }
  return [...ids];
}

/** The provider bare model ids resolve against (the first of AI_PROVIDERS). */
export function primaryProviderId(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return aiProviderIds(env)[0];
}

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

/**
 * pi-ai model registry with the AI_PROVIDERS providers registered (default:
 * the Cloudflare AI Gateway alone). Each built-in provider reads its own key
 * from the environment (OPENAI_API_KEY, ANTHROPIC_API_KEY, ...). The
 * gateway's custom BYOK providers (GATEWAY_CUSTOM_PROVIDERS) route through
 * the gateway, so they register only when it is one of the providers.
 */
export function createProviderModels(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MutableModels {
  const ids = aiProviderIds(env);
  const byId = new Map(builtinProviders().map((provider) => [provider.id, provider]));
  const models = createModels();
  for (const id of ids) {
    const provider = byId.get(id);
    if (provider) models.setProvider(provider);
  }
  if (ids.includes(GATEWAY_PROVIDER)) registerGatewayCustomProviders(models, env);
  return models;
}

/** @deprecated Use `createProviderModels`; same registry (AI_PROVIDERS-driven). */
export const createGatewayModels = createProviderModels;

/**
 * Which registered providers have complete auth right now (a key and any
 * account settings). Uses pi-ai's own check, so it matches what a request
 * would resolve.
 */
export async function configuredProviderIds(models: Models): Promise<Set<string>> {
  const checks = await Promise.all(
    models.getProviders().map(async (provider: Provider) => {
      try {
        return (await models.checkAuth(provider.id)) ? provider.id : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  return new Set(checks.filter((id): id is string => id !== undefined));
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
  // Gateway BYOK providers speak OpenAI-compat whatever the upstream is;
  // a built-in provider (openai, anthropic, ...) keeps its real family.
  if (providerTag?.startsWith("custom:") && !builtinProviderIds().has(model.provider)) {
    return "other";
  }
  if (model.id.startsWith("workers-ai/")) return "workers-ai";
  if (model.api === "anthropic-messages") return "anthropic";
  if (model.api === "openai-responses" || model.api === "openai-completions") return "openai";
  return "other";
}

/**
 * `providerTag` is the "custom:<provider>" prefix a non-primary model id
 * carries; `providerName` is the display name of the provider serving it.
 */
export function toModelInfo(
  model: Model<Api>,
  providerTag?: string,
  providerName?: string,
): ModelInfo {
  return {
    id: providerTag ? `${providerTag}/${model.id}` : model.id,
    name: model.name,
    family: familyOf(model, providerTag),
    provider: providerName ?? model.provider,
    reasoning: Boolean(model.reasoning),
    contextWindow: model.contextWindow,
    vision: (model.input ?? []).includes("image"),
  };
}
