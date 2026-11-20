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
import type { ClaudeCodeModel } from "@tiny-agents/claude-worker";
import type { ProviderKind } from "./types";
import { PROVIDER_KINDS } from "./kinds";

export interface DiscoveredModel {
  upstreamId: string;
  name: string;
  type: "chat" | "classifier";
  contextWindow: number;
  maxOutputTokens: number;
  imageInput: boolean;
  reasoning: boolean;
  compat: Record<string, unknown> | null;
  known: boolean;
  aliases?: string[];
}

export type DiscoveryGet = (
  url: string,
  headers: Record<string, string>,
) => Promise<{ status: number; body: string }>;

export interface DiscoverInput {
  kind: ProviderKind;
  baseUrl: string | null;
  apiKey?: string;
  headers?: Record<string, string>;
  get: DiscoveryGet;
  listClaudePlan?: () => Promise<ClaudeCodeModel[]>;
}

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

const ONE_M = /\[1m\]$/i;

function claudePlanModel(upstreamId: string, fallbackName: string): DiscoveredModel {
  const longContext = ONE_M.test(upstreamId);
  const entry = resolveCapabilities("anthropic", null, upstreamId.replace(ONE_M, ""));
  const defaults = PROVIDER_KINDS["claude-plan"].defaults;
  const name = entry.known ? entry.name : fallbackName;
  return {
    upstreamId,
    name: longContext && entry.known ? `${name} (1M context)` : name,
    type: "chat",
    contextWindow: longContext
      ? 1_000_000
      : entry.known
        ? entry.contextWindow
        : defaults.contextWindow,
    maxOutputTokens: entry.known ? entry.maxOutputTokens : defaults.maxOutputTokens,
    imageInput: true,
    reasoning: true,
    compat: null,
    known: entry.known,
  };
}

export function claudePlanModels(listed: readonly ClaudeCodeModel[]): DiscoveredModel[] {
  const out = new Map<string, DiscoveredModel>();
  for (const model of listed) {
    if (model.value === "default") continue;
    const upstreamId = model.resolvedModel ?? model.value;
    const found = out.get(upstreamId) ?? claudePlanModel(upstreamId, model.displayName);
    const aliases = model.value === upstreamId ? [] : [model.value];
    out.set(upstreamId, {
      ...found,
      ...(aliases.length || found.aliases
        ? { aliases: [...(found.aliases ?? []), ...aliases] }
        : {}),
    });
  }
  return [...out.values()];
}

const values = <T>(catalog: unknown) => Object.values(catalog as Record<string, T>);

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

function catalogEntry(kind: ProviderKind, baseUrl: string | null, upstreamId: string) {
  const anywhere = (id: string) =>
    CATALOGS_BY_HOST.flatMap(([, models]) => models).find((m) => m.id === id);
  if (kind === "cloudflare-ai-gateway") {
    return GATEWAY_CHAT.find((m) => m.id === upstreamId) ?? anywhere(upstreamId.split("/").at(-1)!);
  }
  const host = hostOf(baseUrl ?? PROVIDER_KINDS[kind].defaultBaseUrl ?? null);
  const own = CATALOGS_BY_HOST.find(([h]) => host === h || host.endsWith(`.${h}`))?.[1];
  const bare = upstreamId.replace(/^models\//, "");
  return own?.find((m) => m.id === bare) ?? anywhere(bare);
}

export function resolveCapabilities(
  kind: ProviderKind,
  baseUrl: string | null,
  upstreamId: string,
  name?: string,
): DiscoveredModel {
  if (kind === "claude-plan") {
    return { ...claudePlanModel(upstreamId, name ?? upstreamId), ...(name ? { name } : {}) };
  }
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
  } catch {}
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

function gatewayModel(baseUrl: string | null, model: Model<Api>): DiscoveredModel {
  const resolved = resolveCapabilities("cloudflare-ai-gateway", baseUrl, model.id);
  return model.id.startsWith("workers-ai/")
    ? { ...resolved, name: `${resolved.name} (Workers AI)` }
    : resolved;
}

export async function discoverModels(input: DiscoverInput): Promise<DiscoveredModel[]> {
  const { kind } = input;
  if (kind === "claude-plan") {
    if (!input.listClaudePlan) {
      throw new DiscoveryError("unreachable", "There is no sandbox to run Claude Code on.");
    }
    let listed: ClaudeCodeModel[];
    try {
      listed = await input.listClaudePlan();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new DiscoveryError("unreachable", `Claude Code could not list its models: ${detail}`);
    }
    const models = claudePlanModels(listed);
    if (models.length === 0) {
      throw new DiscoveryError("invalid", "Claude Code listed no models.");
    }
    return models;
  }
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

export interface ProviderTemplate {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string | null;
  aggregator?: boolean;
  keyless?: boolean;
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
