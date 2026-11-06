/**
 * The Model catalog: the one module that knows what a model id means.
 *
 * An app model id has three forms:
 *
 * - bare (`gpt-5`): a model of the primary provider (the first of AI_PROVIDERS);
 * - `custom:<provider>/<model>`: a model of any other registered provider
 *   (AI_PROVIDERS extras and the gateway's BYOK providers); the provider
 *   segment never holds a slash, so the first "/" splits;
 * - `claude-code/<model>`: a Claude plan model, run by the Claude plan engine
 *   and not by any pi-ai provider.
 *
 * Every caller (the runtime's compile, the models endpoint, bot validation,
 * Side-calls, the vision transcriber) asks the catalog instead of parsing or
 * building ids itself, so the grammar, the allowlist and the provider status
 * hold in one place.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { CLAUDE_CODE_MODEL_PREFIX, claudeCodeBareModel } from "./engine";
import { claudePlanModels } from "./engines/claude-code/catalog";
import {
  aiProviderIds,
  builtinProviderIds,
  providerSetupHint,
  unquote,
  type ProviderStatus,
} from "./models";
import type { ModelInfo } from "./types";

const CUSTOM_PREFIX = "custom:";

/** A model as the pi-ai registry addresses it. */
export interface ModelRef {
  provider: string;
  model: string;
}

/** What an app model id names, before asking whether anything serves it. */
export type ParsedModelId = { engine: "claude-code"; bare: string } | ({ engine: "pi" } & ModelRef);

/**
 * Read an app model id. `primary` is the provider bare ids belong to.
 * Undefined when the id is malformed (`custom:/x`, `claude-code/a/b`).
 */
export function parseModelId(id: string, primary: string): ParsedModelId | undefined {
  if (id.startsWith(CLAUDE_CODE_MODEL_PREFIX)) {
    const bare = claudeCodeBareModel(id);
    return bare ? { engine: "claude-code", bare } : undefined;
  }
  if (id.startsWith(CUSTOM_PREFIX)) {
    const rest = id.slice(CUSTOM_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash <= 0 || slash === rest.length - 1) return undefined;
    return { engine: "pi", provider: rest.slice(0, slash), model: rest.slice(slash + 1) };
  }
  return id ? { engine: "pi", provider: primary, model: id } : undefined;
}

/** The app model id of a registry model: bare on the primary provider, `custom:` elsewhere. */
export function formatModelId(ref: ModelRef, primary: string): string {
  return ref.provider === primary ? ref.model : `${CUSTOM_PREFIX}${ref.provider}/${ref.model}`;
}

/** What the catalog reads from the pi-ai registry. */
export type CatalogModels = Pick<
  MutableModels,
  "getModel" | "getModels" | "getProviders" | "getProvider"
>;

export interface ModelCatalogOptions {
  /** The provider bare ids belong to. */
  primary: string;
  /** Providers whose auth resolved (checked once, at open). */
  configured: ReadonlySet<string>;
  /** The env snapshot: AI_PROVIDERS (provider order) and GATEWAY_MODEL_ALLOWLIST. */
  env: Readonly<Record<string, string | undefined>>;
}

export interface ModelCatalog {
  /** The provider bare ids belong to. */
  readonly primary: string;
  /**
   * What the model picker offers: the primary provider's models, every other
   * provider's as `custom:` ids, then the Claude plan models. Once any
   * provider is configured, unconfigured providers are left out (they could
   * not answer). GATEWAY_MODEL_ALLOWLIST, when set, keeps only the ids it names.
   */
  list(): ModelInfo[];
  /**
   * The picker entry for one id, whether or not `list()` offers it today
   * (the allowlist and configured filters do not apply). Undefined when no
   * provider serves it.
   */
  info(id: string): ModelInfo | undefined;
  /**
   * Whether a bot can run on `id`: a registry model some provider serves,
   * or any well-formed Claude plan id (the worker passes it through to
   * Claude Code). Not narrowed by GATEWAY_MODEL_ALLOWLIST, which only trims
   * the picker: a bot saved on a model the allowlist later hides keeps
   * running and stays editable.
   */
  has(id: string): boolean;
  /**
   * The registry model a pi turn or a Side-call runs `id` on. A Claude plan
   * id resolves to the same bare model on a provider that serves it (the
   * primary first), and to nothing when none does.
   */
  resolve(id: string): ModelRef | undefined;
  /** The registry model object behind `id`, as `resolve` finds it. */
  model(id: string): Model<Api> | undefined;
  /** The configured inference providers, primary first, and whether each has credentials. */
  providers(): ProviderStatus[];
  /** Whether some provider can answer: one has credentials, or the runtime runs on faux. */
  canAnswer(): boolean;
}

export function createModelCatalog(
  models: CatalogModels,
  options: ModelCatalogOptions,
): ModelCatalog {
  const { primary, configured } = options;
  const allowlist = parseAllowlist(options.env.GATEWAY_MODEL_ALLOWLIST);
  const providerIds = [primary, ...aiProviderIds(options.env)].filter(
    (id, index, all) => all.indexOf(id) === index && models.getProvider(id) !== undefined,
  );
  const nameOf = (provider: string) => models.getProvider(provider)?.name ?? provider;
  const served = (ref: ModelRef) => models.getModel(ref.provider, ref.model) !== undefined;
  const infoOf = (model: Model<Api>, provider: string): ModelInfo =>
    toModelInfo(model, { provider, primary, providerName: nameOf(provider) });

  const resolve = (id: string): ModelRef | undefined => {
    const parsed = parseModelId(id, primary);
    if (!parsed) return undefined;
    if (parsed.engine === "pi") {
      const ref = { provider: parsed.provider, model: parsed.model };
      return served(ref) ? ref : undefined;
    }
    const providers = [primary, ...models.getProviders().map((p) => p.id)];
    return providers
      .map((provider) => ({ provider, model: parsed.bare }))
      .find((ref) => served(ref));
  };

  return {
    primary,
    list() {
      const anyConfigured = configured.size > 0;
      const listed = (provider: string) => !anyConfigured || configured.has(provider);
      const providers = [
        primary,
        ...models
          .getProviders()
          .map((p) => p.id)
          .filter((id) => id !== primary),
      ].filter(listed);
      const all = [
        ...providers.flatMap((provider) =>
          models.getModels(provider).map((model) => infoOf(model, provider)),
        ),
        ...claudePlanModels(),
      ];
      return allowlist ? all.filter((m) => allowlist.has(m.id)) : all;
    },
    info(id) {
      const parsed = parseModelId(id, primary);
      if (!parsed) return undefined;
      if (parsed.engine === "claude-code") return claudePlanModels().find((m) => m.id === id);
      const model = models.getModel(parsed.provider, parsed.model);
      return model ? infoOf(model, parsed.provider) : undefined;
    },
    has(id) {
      const parsed = parseModelId(id, primary);
      if (!parsed) return false;
      return parsed.engine === "claude-code" || served(parsed);
    },
    resolve,
    model(id) {
      const ref = resolve(id);
      return ref ? models.getModel(ref.provider, ref.model) : undefined;
    },
    providers() {
      return providerIds.map((id) => {
        const name = nameOf(id);
        return {
          id,
          name,
          configured: configured.has(id),
          setupHint: providerSetupHint(id, name),
        };
      });
    },
    canAnswer() {
      return primary === "faux" || providerIds.some((id) => configured.has(id));
    },
  };
}

/** GATEWAY_MODEL_ALLOWLIST (comma-separated ids, the whole value may be quote-wrapped), or null. */
function parseAllowlist(raw: string | undefined): Set<string> | null {
  const ids = (unquote(raw) ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

/** Gateway BYOK providers speak OpenAI-compat whatever the upstream is; built-ins keep their family. */
function familyOf(model: Model<Api>, custom: boolean): ModelInfo["family"] {
  if (custom && !builtinProviderIds().has(model.provider)) return "other";
  if (model.id.startsWith("workers-ai/")) return "workers-ai";
  if (model.api === "anthropic-messages") return "anthropic";
  if (model.api === "openai-responses" || model.api === "openai-completions") return "openai";
  return "other";
}

/** The picker entry for a registry model served by `provider`. */
export function toModelInfo(
  model: Model<Api>,
  options: { provider: string; primary: string; providerName?: string },
): ModelInfo {
  const custom = options.provider !== options.primary;
  return {
    id: formatModelId({ provider: options.provider, model: model.id }, options.primary),
    name: model.name,
    family: familyOf(model, custom),
    provider: options.providerName ?? model.provider,
    reasoning: Boolean(model.reasoning),
    contextWindow: model.contextWindow,
    vision: (model.input ?? []).includes("image"),
  };
}
