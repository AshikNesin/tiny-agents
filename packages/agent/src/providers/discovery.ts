/**
 * Model discovery and capabilities (issue #179): what an account's endpoint
 * lists, and what each model can do.
 *
 * - Discovery asks the endpoint (`GET /models` and its kind's variants)
 *   through the `get` the app hands in: the app's guarded fetch, so this
 *   module never opens a connection itself. Static kinds (the gateway's
 *   catalog, the Claude plan) list without a request.
 * - Capabilities come from pi-ai's built-in per-provider catalogs, matched by
 *   the endpoint's host and then by upstream id; else the kind's defaults.
 *   Owner overrides win over both (the app applies them).
 */
import type { Api, ClassifierApi, ClassifierModel, Model } from "@earendil-works/pi-ai";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { CLOUDFLARE_AI_GATEWAY_MODELS } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway.models";
import { CLOUDFLARE_WORKERS_AI_CLASSIFIER_MODELS } from "@earendil-works/pi-ai/providers/cloudflare-workers-ai.models";
import { DEEPSEEK_MODELS } from "@earendil-works/pi-ai/providers/deepseek.models";
import { FIREWORKS_MODELS } from "@earendil-works/pi-ai/providers/fireworks.models";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { GROQ_MODELS } from "@earendil-works/pi-ai/providers/groq.models";
import { MISTRAL_MODELS } from "@earendil-works/pi-ai/providers/mistral.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import { TOGETHER_MODELS } from "@earendil-works/pi-ai/providers/together.models";
import { XAI_MODELS } from "@earendil-works/pi-ai/providers/xai.models";
import { ZAI_MODELS } from "@earendil-works/pi-ai/providers/zai.models";
import type { ProviderKind } from "../types";
import { PROVIDER_KINDS } from "./kinds";

/** A model an endpoint lists, with its resolved capabilities. */
export interface DiscoveredModel {
  upstreamId: string;
  name: string;
  type: "chat" | "classifier";
  contextWindow: number;
  maxOutputTokens: number;
  imageInput: boolean;
  reasoning: boolean;
  compat: Record<string, unknown> | null;
  /** Capabilities came from a catalog (false: the kind's defaults, "unknown capabilities"). */
  known: boolean;
}

/** One HTTP GET, as the app's guarded fetch answers it. */
export type DiscoveryGet = (
  url: string,
  headers: Record<string, string>,
) => Promise<{ status: number; body: string }>;

export interface DiscoverInput {
  kind: ProviderKind;
  baseUrl: string | null;
  apiKey?: string;
  /**
   * Headers that authenticate the listing instead of the kind's own (a
   * gateway route lists through its gateway, on the gateway's token).
   */
  headers?: Record<string, string>;
  get: DiscoveryGet;
}

/** Why discovery failed, for the account's status. */
export class DiscoveryError extends Error {
  constructor(
    readonly code: "key_rejected" | "unreachable" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "DiscoveryError";
  }
}

const MAX_PAGES = 50;
const MAX_MODELS = 5_000;

/** The Claude plan's models: the worker passes the upstream id to Claude Code. */
const CLAUDE_PLAN_MODELS: readonly DiscoveredModel[] = [
  ["claude-opus-4-6", "Claude Opus 4.6"],
  ["claude-sonnet-4-6", "Claude Sonnet 4.6"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"],
].map(([upstreamId, name]) => ({
  upstreamId: upstreamId!,
  name: name!,
  type: "chat",
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  imageInput: true,
  reasoning: true,
  compat: null,
  known: true,
}));

const values = <T>(catalog: unknown) => Object.values(catalog as Record<string, T>);

/** pi-ai's catalogs, by the host whose models they describe. */
const CATALOGS_BY_HOST: readonly [string, Model<Api>[]][] = [
  ["api.anthropic.com", values(ANTHROPIC_MODELS)],
  ["api.openai.com", values(OPENAI_MODELS)],
  ["generativelanguage.googleapis.com", values(GOOGLE_MODELS)],
  ["openrouter.ai", values(OPENROUTER_MODELS)],
  ["api.groq.com", values(GROQ_MODELS)],
  ["api.deepseek.com", values(DEEPSEEK_MODELS)],
  ["api.mistral.ai", values(MISTRAL_MODELS)],
  ["api.together.xyz", values(TOGETHER_MODELS)],
  ["api.z.ai", values(ZAI_MODELS)],
  ["api.x.ai", values(XAI_MODELS)],
  ["api.fireworks.ai", values(FIREWORKS_MODELS)],
];

const GATEWAY_CHAT = values<Model<Api>>(CLOUDFLARE_AI_GATEWAY_MODELS);
const WORKERS_AI_CLASSIFIERS = values<ClassifierModel<ClassifierApi>>(
  CLOUDFLARE_WORKERS_AI_CLASSIFIER_MODELS,
);

const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
};

/** The catalog entry describing `upstreamId` at this endpoint, if any. */
function catalogEntry(kind: ProviderKind, baseUrl: string | null, upstreamId: string) {
  const anywhere = (id: string) =>
    CATALOGS_BY_HOST.flatMap(([, models]) => models).find((m) => m.id === id);
  if (kind === "cloudflare-ai-gateway") {
    // A gateway id is `<provider>/<model>` (`custom-zai-coding-plan/glm-5.3-flash`
    // for a custom provider): unknown to the gateway's catalog, the model part
    // may still be known.
    return GATEWAY_CHAT.find((m) => m.id === upstreamId) ?? anywhere(upstreamId.split("/").at(-1)!);
  }
  const host = hostOf(baseUrl ?? PROVIDER_KINDS[kind].defaultBaseUrl ?? null);
  const own = CATALOGS_BY_HOST.find(([h]) => host === h || host.endsWith(`.${h}`))?.[1];
  const bare = upstreamId.replace(/^models\//, "");
  return own?.find((m) => m.id === bare) ?? anywhere(bare);
}

/**
 * A model's capabilities at this endpoint: pi-ai's catalog entry (by host,
 * then by id anywhere), else the kind's defaults (`known: false`).
 */
export function resolveCapabilities(
  kind: ProviderKind,
  baseUrl: string | null,
  upstreamId: string,
  name?: string,
): DiscoveredModel {
  const entry = catalogEntry(kind, baseUrl, upstreamId);
  const defaults = PROVIDER_KINDS[kind].defaults;
  return {
    upstreamId,
    name: name ?? entry?.name ?? upstreamId,
    type: "chat",
    contextWindow: entry?.contextWindow ?? defaults.contextWindow,
    maxOutputTokens: entry?.maxTokens ?? defaults.maxOutputTokens,
    imageInput: entry ? (entry.input ?? []).includes("image") : false,
    reasoning: entry?.reasoning ?? false,
    compat: (entry?.compat as Record<string, unknown> | undefined) ?? null,
    known: entry !== undefined,
  };
}

function parseJson(body: string, what: string): Record<string, unknown> {
  try {
    const value = JSON.parse(body) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new DiscoveryError("invalid", `${what} did not answer with a model list.`);
}

async function getJson(
  input: DiscoverInput,
  url: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const { status, body } = await input.get(url, headers);
  if (status === 401 || status === 403) {
    throw new DiscoveryError("key_rejected", `The endpoint refused the key (HTTP ${status}).`);
  }
  if (status < 200 || status >= 300) {
    throw new DiscoveryError("unreachable", `The endpoint answered HTTP ${status}.`);
  }
  return parseJson(body, "The endpoint");
}

const trim = (url: string) => url.replace(/\/+$/, "");

async function listAnthropic(input: DiscoverInput, base: string) {
  const ids: { id: string; name?: string }[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES && ids.length < MAX_MODELS; page++) {
    const url = `${base}/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`;
    const body = await getJson(input, url, {
      "x-api-key": input.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    });
    const data = Array.isArray(body.data) ? body.data : [];
    for (const item of data as { id?: unknown; display_name?: unknown }[]) {
      if (typeof item.id === "string") {
        ids.push({
          id: item.id,
          ...(typeof item.display_name === "string" ? { name: item.display_name } : {}),
        });
      }
    }
    if (body.has_more !== true || typeof body.last_id !== "string") break;
    after = body.last_id;
  }
  return ids;
}

async function listOpenAi(input: DiscoverInput, base: string) {
  const body = await getJson(
    input,
    `${base}/models`,
    input.headers ?? (input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
  );
  const data = Array.isArray(body.data) ? body.data : [];
  return (data as { id?: unknown; name?: unknown }[]).flatMap((item) =>
    typeof item.id === "string"
      ? [{ id: item.id, ...(typeof item.name === "string" ? { name: item.name } : {}) }]
      : [],
  );
}

async function listGemini(input: DiscoverInput, base: string) {
  const out: { id: string; name?: string; context?: number; output?: number }[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES && out.length < MAX_MODELS; page++) {
    const url = `${base}/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
    const body = await getJson(input, url, { "x-goog-api-key": input.apiKey ?? "" });
    const models = Array.isArray(body.models) ? body.models : [];
    for (const item of models as Record<string, unknown>[]) {
      const methods = Array.isArray(item.supportedGenerationMethods)
        ? item.supportedGenerationMethods
        : [];
      if (typeof item.name !== "string" || !methods.includes("generateContent")) continue;
      out.push({
        id: item.name.replace(/^models\//, ""),
        ...(typeof item.displayName === "string" ? { name: item.displayName } : {}),
        ...(typeof item.inputTokenLimit === "number" ? { context: item.inputTokenLimit } : {}),
        ...(typeof item.outputTokenLimit === "number" ? { output: item.outputTokenLimit } : {}),
      });
    }
    if (typeof body.nextPageToken !== "string" || !body.nextPageToken) break;
    token = body.nextPageToken;
  }
  return out;
}

/**
 * A gateway catalog model, named so it can't be mistaken for one of the
 * owner's own providers: Workers AI models run on Cloudflare's plan, not on
 * a key the owner stored in the gateway.
 */
function gatewayModel(baseUrl: string | null, model: Model<Api>): DiscoveredModel {
  const resolved = resolveCapabilities("cloudflare-ai-gateway", baseUrl, model.id);
  return model.id.startsWith("workers-ai/")
    ? { ...resolved, name: `${resolved.name} (Workers AI)` }
    : resolved;
}

/**
 * The models an account's endpoint offers, capabilities resolved. Throws a
 * `DiscoveryError` the account's status can show.
 */
export async function discoverModels(input: DiscoverInput): Promise<DiscoveredModel[]> {
  const { kind } = input;
  if (kind === "claude-plan") return [...CLAUDE_PLAN_MODELS];
  if (kind === "faux") return [];
  if (kind === "cloudflare-ai-gateway") {
    return [
      ...GATEWAY_CHAT.map((m) => gatewayModel(input.baseUrl, m)),
      ...WORKERS_AI_CLASSIFIERS.map((m) => ({
        upstreamId: m.id,
        name: m.name,
        type: "classifier" as const,
        contextWindow: m.contextWindow,
        maxOutputTokens: 0,
        imageInput: false,
        reasoning: false,
        compat: null,
        known: true,
      })),
    ];
  }
  const base = trim(input.baseUrl ?? PROVIDER_KINDS[kind].defaultBaseUrl ?? "");
  if (!base) throw new DiscoveryError("invalid", "The account has no endpoint.");
  if (kind === "anthropic") {
    return (await listAnthropic(input, base))
      .slice(0, MAX_MODELS)
      .map((m) => resolveCapabilities(kind, base, m.id, m.name));
  }
  if (kind === "gemini") {
    return (await listGemini(input, base)).slice(0, MAX_MODELS).map((m) => {
      const resolved = resolveCapabilities(kind, base, m.id, m.name);
      return {
        ...resolved,
        ...(m.context ? { contextWindow: m.context } : {}),
        ...(m.output ? { maxOutputTokens: m.output } : {}),
      };
    });
  }
  return (await listOpenAi(input, base))
    .slice(0, MAX_MODELS)
    .map((m) => resolveCapabilities(kind, base, m.id, m.name));
}

/** Endpoints the Add Models dialog offers, by template. */
export interface ProviderTemplate {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string | null;
  /** Lists hundreds of models: discovered models start unchecked. */
  aggregator?: boolean;
  /** No key needed (a local server). */
  keyless?: boolean;
  /** A private or LAN endpoint the owner opts in to. */
  privateNetwork?: boolean;
}

export const PROVIDER_TEMPLATES: readonly ProviderTemplate[] = [
  { id: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com" },
  { id: "openai", label: "OpenAI", kind: "openai-responses", baseUrl: "https://api.openai.com/v1" },
  {
    id: "gemini",
    label: "Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-chat",
    baseUrl: "https://openrouter.ai/api/v1",
    aggregator: true,
  },
  {
    id: "cloudflare-ai-gateway",
    label: "Cloudflare AI Gateway",
    kind: "cloudflare-ai-gateway",
    baseUrl: null,
    aggregator: true,
  },
  { id: "groq", label: "Groq", kind: "openai-chat", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "deepseek", label: "DeepSeek", kind: "openai-chat", baseUrl: "https://api.deepseek.com" },
  { id: "mistral", label: "Mistral", kind: "openai-chat", baseUrl: "https://api.mistral.ai/v1" },
  {
    id: "together",
    label: "Together",
    kind: "openai-chat",
    baseUrl: "https://api.together.xyz/v1",
    aggregator: true,
  },
  { id: "zai", label: "z.ai", kind: "openai-chat", baseUrl: "https://api.z.ai/api/paas/v4" },
  {
    id: "zai-coding",
    label: "z.ai Coding Plan",
    kind: "openai-chat",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
  },
  {
    id: "ollama",
    label: "Ollama",
    kind: "openai-chat",
    baseUrl: "http://localhost:11434/v1",
    keyless: true,
    privateNetwork: true,
  },
  { id: "claude-plan", label: "Claude plan", kind: "claude-plan", baseUrl: null, keyless: true },
];
