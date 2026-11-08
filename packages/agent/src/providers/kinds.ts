/**
 * Provider kinds (issue #179): one entry per way of reaching models. A kind
 * fixes the wire API, how the key is sent, the default endpoint, the default
 * capabilities and the engine. Adding a kind means adding one entry here.
 *
 * `buildProviders` projects the owner's accounts and model rows onto pi-ai
 * providers: each account becomes one provider whose id is the row id, so
 * renaming an account changes no stored reference.
 */
import type { Api, ClassifierApi, ClassifierModel, Model } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { classifySystemOne } from "@earendil-works/pi-ai/api/system-one-shared";
import { createProvider, type Provider } from "@earendil-works/pi-ai/models";
import { CLOUDFLARE_AI_GATEWAY_MODELS } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway.models";
import { cloudflareStreams } from "@earendil-works/pi-ai/providers/cloudflare-stream";
import { CLOUDFLARE_WORKERS_AI_CLASSIFIER_MODELS } from "@earendil-works/pi-ai/providers/cloudflare-workers-ai.models";
import type { AgentEngineKind, ProviderKind } from "../types";
import type { CredentialResolver, ModelConfig, ModelRow, ProviderAccount } from "./config";
import { workersAiTransport } from "./workers-ai";

const GATEWAY_HOST = "https://gateway.ai.cloudflare.com";

type ChatApi =
  | "anthropic-messages"
  | "openai-completions"
  | "openai-responses"
  | "google-generative-ai";

export interface KindSpec {
  label: string;
  engine: AgentEngineKind;
  /** The chat wire API; absent for kinds whose models aren't served through pi-ai by us. */
  api?: ChatApi;
  /** The endpoint a new account starts with. */
  defaultBaseUrl?: string;
  /** Capabilities a model gets when nothing better is known. */
  defaults: { contextWindow: number; maxOutputTokens: number };
}

export const PROVIDER_KINDS: Readonly<Record<ProviderKind, KindSpec>> = {
  anthropic: {
    label: "Anthropic",
    engine: "pi",
    api: "anthropic-messages",
    defaultBaseUrl: "https://api.anthropic.com",
    defaults: { contextWindow: 200_000, maxOutputTokens: 32_000 },
  },
  "openai-chat": {
    label: "OpenAI Chat",
    engine: "pi",
    api: "openai-completions",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaults: { contextWindow: 128_000, maxOutputTokens: 16_384 },
  },
  "openai-responses": {
    label: "OpenAI Responses",
    engine: "pi",
    api: "openai-responses",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaults: { contextWindow: 128_000, maxOutputTokens: 16_384 },
  },
  gemini: {
    label: "Gemini",
    engine: "pi",
    api: "google-generative-ai",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaults: { contextWindow: 1_000_000, maxOutputTokens: 65_536 },
  },
  "cloudflare-ai-gateway": {
    label: "Cloudflare AI Gateway",
    engine: "pi",
    defaultBaseUrl: GATEWAY_HOST,
    defaults: { contextWindow: 128_000, maxOutputTokens: 16_384 },
  },
  "claude-plan": {
    label: "Claude plan",
    engine: "claude-code",
    defaults: { contextWindow: 200_000, maxOutputTokens: 32_000 },
  },
  faux: {
    label: "Faux (tests)",
    engine: "pi",
    defaults: { contextWindow: 128_000, maxOutputTokens: 16_384 },
  },
};

/** Picker note shown beside every Claude plan model. */
export const CLAUDE_PLAN_NOTE = "uses your Claude plan";

/** Where a classifier model of a gateway account is registered (its own auth). */
export const classifierProviderId = (accountId: string) => `${accountId}:classifier`;

const API_FACTORIES: Record<ChatApi, () => ReturnType<typeof openAICompletionsApi>> = {
  "anthropic-messages": anthropicMessagesApi,
  "openai-completions": openAICompletionsApi,
  "openai-responses": openAIResponsesApi,
  "google-generative-ai": googleGenerativeAIApi,
};

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const GATEWAY_CATALOG = new Map(
  (Object.values(CLOUDFLARE_AI_GATEWAY_MODELS) as Model<Api>[]).map((model) => [model.id, model]),
);

const WORKERS_AI_CLASSIFIERS = new Map(
  (Object.values(CLOUDFLARE_WORKERS_AI_CLASSIFIER_MODELS) as ClassifierModel<ClassifierApi>[]).map(
    (model) => [model.id, model],
  ),
);

const trimSlash = (url: string) => url.replace(/\/+$/, "");

function chatModel(
  row: ModelRow,
  providerId: string,
  api: ChatApi,
  baseUrl: string,
  base?: Model<Api>,
): Model<Api> {
  return {
    ...base,
    id: row.upstreamId,
    name: row.name,
    api,
    provider: providerId,
    baseUrl,
    reasoning: row.reasoning,
    input: row.imageInput ? ["text", "image"] : ["text"],
    contextWindow: row.contextWindow,
    maxTokens: row.maxOutputTokens,
    cost: base?.cost ?? ZERO_COST,
    ...(row.compat ? { compat: row.compat } : {}),
    ...thinkingMap(base, row.compat),
  } as Model<Api>;
}

/**
 * Models that always think adaptively (Claude Sonnet 5.5, Opus 5.5) refuse
 * `thinking: {type: "disabled"}`, which pi-ai sends for a call with no
 * thinking level (a Test, a chat title, a memory capture) unless the model
 * says "off" is unsupported. Saying so leaves the thinking setting out, so
 * the model uses its own default.
 */
function thinkingMap(base: Model<Api> | undefined, compat: Record<string, unknown> | null) {
  const adaptive =
    compat?.forceAdaptiveThinking === true ||
    (base?.compat as { forceAdaptiveThinking?: boolean } | undefined)?.forceAdaptiveThinking;
  return adaptive ? { thinkingLevelMap: { ...base?.thinkingLevelMap, off: null } } : {};
}

interface GatewaySettings {
  accountId: string;
  gatewayId: string;
}

function gatewaySettings(account: ProviderAccount): GatewaySettings | undefined {
  const { accountId, gatewayId } = account.settings as Partial<GatewaySettings>;
  return typeof accountId === "string" && accountId && typeof gatewayId === "string" && gatewayId
    ? { accountId, gatewayId }
    : undefined;
}

/**
 * A provider the owner configured in the gateway itself (BYOK "custom
 * provider", e.g. Z.AI's coding plan): its slug, and the path the gateway
 * appends after it.
 */
export interface GatewayCustomProvider {
  /** `custom-<name>`, as the gateway names it. */
  slug: string;
  /** Appended to the provider's base URL (`api/coding/paas/v4`). */
  basePath?: string;
}

function gatewayCustomProviders(settings: Record<string, unknown>): GatewayCustomProvider[] {
  const list = Array.isArray(settings.customProviders) ? settings.customProviders : [];
  return list.flatMap((entry) => {
    const { slug, basePath } = (entry ?? {}) as Partial<GatewayCustomProvider>;
    return typeof slug === "string" && slug
      ? [{ slug, ...(typeof basePath === "string" && basePath ? { basePath } : {}) }]
      : [];
  });
}

/** Where a gateway account's custom provider is registered (its own base URL). */
const customProviderId = (accountId: string, slug: string) => `${accountId}:${slug}`;

/** The custom provider slug a gateway model id names (`custom-x/model` → `custom-x`). */
function customSlugOf(upstreamId: string): string | undefined {
  const slash = upstreamId.indexOf("/");
  const slug = slash > 0 ? upstreamId.slice(0, slash) : "";
  return slug.startsWith("custom-") ? slug : undefined;
}

/**
 * The account's custom providers: those in its settings, plus any slug one of
 * its models names that the settings lack (no base path yet), so a model added
 * by id still goes to its provider's URL rather than the unified endpoint,
 * which answers 404 for every custom provider.
 */
function customProvidersFor(
  settings: Record<string, unknown>,
  rows: readonly Pick<ModelRow, "upstreamId">[],
): GatewayCustomProvider[] {
  const configured = gatewayCustomProviders(settings);
  const known = new Set(configured.map((p) => p.slug));
  const extra = new Set<string>();
  for (const row of rows) {
    const slug = customSlugOf(row.upstreamId);
    if (slug && !known.has(slug)) extra.add(slug);
  }
  return [...configured, ...[...extra].map((slug) => ({ slug }))];
}

/**
 * How a gateway account's model is called. A model of one of its custom
 * providers (`custom-zai-coding-plan/glm-5.3-flash`) goes to that provider's
 * own gateway URL under its bare id: the gateway's unified endpoint can't add
 * the provider's base path. A `custom-…` slug the settings lack routes the
 * same way. Every other model is the account's own.
 */
export function gatewayModelRoute(
  account: Pick<ProviderAccount, "id">,
  upstreamId: string,
): { providerId: string; upstreamId: string } {
  // Settings only hold `custom-…` slugs (the schema), so the id alone decides.
  const slug = customSlugOf(upstreamId);
  return slug
    ? {
        providerId: customProviderId(account.id, slug),
        upstreamId: upstreamId.slice(slug.length + 1),
      }
    : { providerId: account.id, upstreamId };
}

/** A custom provider's base URL through the gateway. */
export function gatewayCustomBaseUrl(
  frontDoor: string,
  settings: GatewaySettings,
  provider: GatewayCustomProvider,
): string {
  const basePath = provider.basePath?.replace(/^\/+|\/+$/g, "");
  return [trimSlash(frontDoor), "v1", settings.accountId, settings.gatewayId, provider.slug]
    .concat(basePath ? [basePath] : [])
    .join("/");
}

/** The gateway's own host, or the account's front door when it set one. */
const gatewayFrontDoor = (account: ProviderAccount) => trimSlash(account.baseUrl || GATEWAY_HOST);

function keyAuth(name: string, account: ProviderAccount, credentials: CredentialResolver) {
  return {
    apiKey: {
      name,
      resolve: async ({ signal }: { signal: AbortSignal }) => {
        if (!account.hasCredential) return { auth: { apiKey: "no-key" }, source: "none" };
        const key = await credentials.resolve(account.id, signal);
        return key ? { auth: { apiKey: key }, source: "vault" } : undefined;
      },
    },
  };
}

function gatewayAuth(
  gateway: ProviderAccount,
  settings: GatewaySettings,
  credentials: CredentialResolver,
) {
  return {
    apiKey: {
      name: "Cloudflare AI Gateway token",
      resolve: async ({ signal }: { signal: AbortSignal }) => {
        const key = gateway.hasCredential
          ? await credentials.resolve(gateway.id, signal)
          : undefined;
        if (gateway.hasCredential && !key) return undefined;
        return {
          auth: {
            headers: {
              ...(key ? { "cf-aig-authorization": `Bearer ${key}` } : {}),
              Authorization: null,
              "x-api-key": null,
            },
          },
          env: {
            CLOUDFLARE_ACCOUNT_ID: settings.accountId,
            CLOUDFLARE_GATEWAY_ID: settings.gatewayId,
          },
          source: "vault",
        };
      },
    },
  };
}

/** The gateway account's pi-ai providers: chat models, and classifiers (their own auth). */
function gatewayProviders(
  account: ProviderAccount,
  rows: readonly ModelRow[],
  credentials: CredentialResolver,
): Provider[] {
  const settings = gatewaySettings(account);
  if (!settings) return [];
  const frontDoor = gatewayFrontDoor(account);
  const placeholderBase = (url: string) => url.replace(GATEWAY_HOST, frontDoor).replace(/\/+$/, "");
  const custom = customProvidersFor(account.settings, rows);
  const customOf = (row: ModelRow) => gatewayModelRoute(account, row.upstreamId);
  const chat = rows
    .filter((row) => row.type === "chat" && customOf(row).providerId === account.id)
    .map((row) => {
      const base = GATEWAY_CATALOG.get(row.upstreamId);
      const api = (base?.api as ChatApi | undefined) ?? "openai-completions";
      const baseUrl = base
        ? placeholderBase(base.baseUrl)
        : `${frontDoor}/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat`;
      return chatModel(row, account.id, api, baseUrl, base);
    });
  const providers: Provider[] = [
    createProvider({
      id: account.id,
      name: account.name,
      auth: gatewayAuth(account, settings, credentials),
      models: chat,
      api: {
        "anthropic-messages": cloudflareStreams(anthropicMessagesApi()),
        "openai-completions": cloudflareStreams(openAICompletionsApi()),
        "openai-responses": cloudflareStreams(openAIResponsesApi()),
      },
    }) as Provider,
  ];
  // Each custom provider: its own pi-ai provider on its own gateway URL,
  // models under their bare ids, on the gateway's token.
  for (const provider of custom) {
    const baseUrl = gatewayCustomBaseUrl(frontDoor, settings, provider);
    const id = customProviderId(account.id, provider.slug);
    const models = rows
      .filter((row) => row.type === "chat" && customOf(row).providerId === id)
      .map((row) =>
        chatModel(
          { ...row, upstreamId: customOf(row).upstreamId },
          id,
          "openai-completions",
          baseUrl,
        ),
      );
    if (models.length === 0) continue;
    providers.push(
      createProvider({
        id,
        name: `${account.name} (${provider.slug})`,
        baseUrl,
        auth: gatewayAuth(account, settings, credentials),
        models,
        api: openAICompletionsApi(),
      }) as Provider,
    );
  }
  const classifiers = rows
    .filter((row) => row.type === "classifier")
    .flatMap((row): ClassifierModel<ClassifierApi>[] => {
      const known = WORKERS_AI_CLASSIFIERS.get(row.upstreamId);
      if (!known) return [];
      return [
        {
          ...known,
          name: row.name,
          provider: classifierProviderId(account.id),
          baseUrl: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(settings.accountId)}/ai`,
        },
      ];
    });
  if (classifiers.length > 0) {
    providers.push(
      createProvider({
        id: classifierProviderId(account.id),
        name: `${account.name} (classifiers)`,
        auth: {
          apiKey: {
            name: "Cloudflare AI Gateway token",
            // Workers AI reads Authorization; an authenticated gateway reads
            // cf-aig-authorization; cf-aig-gateway-id routes the call through it.
            resolve: async ({ signal }: { signal: AbortSignal }) => {
              const key = await credentials.resolve(account.id, signal);
              if (!key) return undefined;
              return {
                auth: {
                  apiKey: key,
                  headers: {
                    Authorization: `Bearer ${key}`,
                    "cf-aig-authorization": `Bearer ${key}`,
                    "cf-aig-gateway-id": settings.gatewayId,
                  },
                },
                source: "vault",
              };
            },
          },
        },
        models: classifiers,
        classifiers: {
          "cloudflare-workers-ai-system-one": {
            classify: (model, context, options) =>
              classifySystemOne(workersAiTransport, model, context, options),
          },
        },
      }) as Provider,
    );
  }
  return providers;
}

/** An OpenAI Chat account routed through a gateway account (BYOK upstream). */
function gatewayRouteProvider(
  account: ProviderAccount,
  gateway: ProviderAccount,
  rows: readonly ModelRow[],
  credentials: CredentialResolver,
): Provider | undefined {
  const settings = gatewaySettings(gateway);
  const upstream = typeof account.settings.upstream === "string" ? account.settings.upstream : "";
  if (!settings || !upstream) return undefined;
  const basePath =
    typeof account.settings.basePath === "string"
      ? account.settings.basePath.replace(/^\/+|\/+$/g, "")
      : "";
  const baseUrl = [
    gatewayFrontDoor(gateway),
    "v1",
    settings.accountId,
    settings.gatewayId,
    upstream,
  ]
    .concat(basePath ? [basePath] : [])
    .join("/");
  return createProvider({
    id: account.id,
    name: account.name,
    baseUrl,
    auth: gatewayAuth(gateway, settings, credentials),
    models: rows
      .filter((row) => row.type === "chat")
      .map((row) => chatModel(row, account.id, "openai-completions", baseUrl)),
    api: openAICompletionsApi(),
  }) as Provider;
}

/**
 * The pi-ai providers the accounts project to. Disabled accounts and kinds
 * pi-ai doesn't serve for us (claude-plan; faux, whose provider the host
 * passes in) build nothing.
 */
export function buildProviders(config: ModelConfig, credentials: CredentialResolver): Provider[] {
  const byId = new Map(config.providers.map((account) => [account.id, account]));
  const providers: Provider[] = [];
  for (const account of config.providers) {
    if (!account.enabled) continue;
    const rows = config.models.filter((row) => row.providerId === account.id);
    if (account.kind === "cloudflare-ai-gateway") {
      providers.push(...gatewayProviders(account, rows, credentials));
      continue;
    }
    if (account.viaProviderId) {
      const gateway = byId.get(account.viaProviderId);
      if (!gateway?.enabled) continue;
      const route = gatewayRouteProvider(account, gateway, rows, credentials);
      if (route) providers.push(route);
      continue;
    }
    const spec = PROVIDER_KINDS[account.kind];
    if (!spec.api) continue;
    const baseUrl = trimSlash(account.baseUrl || spec.defaultBaseUrl || "");
    if (!baseUrl) continue;
    providers.push(
      createProvider({
        id: account.id,
        name: account.name,
        baseUrl,
        auth: keyAuth(`${spec.label} key`, account, credentials),
        models: rows
          .filter((row) => row.type === "chat")
          .map((row) => chatModel(row, account.id, spec.api!, baseUrl)),
        api: API_FACTORIES[spec.api](),
      }) as Provider,
    );
  }
  return providers;
}
