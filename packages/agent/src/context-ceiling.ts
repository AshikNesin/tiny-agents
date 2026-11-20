import type { Models } from "@earendil-works/pi-ai/models";
import type { CompactionPolicy, CompactionSettings } from "@earendil-works/pi-durable";

const CONTEXT_CEILING_TOKENS = 150_000;

const DEFAULT_RESERVE_TOKENS = 16_384;

type ModelLookup = Pick<Models, "getModel">;

function ceilingReserve(models: ModelLookup, key: string): number | undefined {
  const slash = key.indexOf("/");
  if (slash <= 0) return undefined;
  const model = models.getModel(key.slice(0, slash), key.slice(slash + 1));
  const window = model?.contextWindow ?? 0;
  const reserve = window - CONTEXT_CEILING_TOKENS;
  return reserve > DEFAULT_RESERVE_TOKENS ? reserve : undefined;
}

export function withContextCeiling(
  models: ModelLookup | (() => ModelLookup),
  settings: CompactionSettings = {},
): CompactionSettings {
  const current = typeof models === "function" ? models : () => models;
  const explicit = settings.modelOverrides ?? {};
  const overrides = new Proxy({} as Record<string, Partial<CompactionPolicy>>, {
    get(_target, key) {
      if (typeof key !== "string") return undefined;
      if (Object.hasOwn(explicit, key)) return explicit[key];
      const reserveTokens = ceilingReserve(current(), key);
      return reserveTokens === undefined ? undefined : { reserveTokens };
    },
  });
  return { ...settings, modelOverrides: overrides };
}
