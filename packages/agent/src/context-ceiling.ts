/**
 * The context ceiling: a chat is summarized once its context passes about
 * `CONTEXT_CEILING_TOKENS`, whatever the model's window. pi-durable on its
 * own compacts only near `contextWindow - reserveTokens`, so on a 1M-token
 * model one chat request (and every tool step after it) could carry close to
 * a million tokens before the first summary. Hermes Agent compresses at half
 * the window for the same reason.
 *
 * pi-durable reads its compaction policy per model (`modelOverrides`, keyed
 * `"provider/modelId"`) at every resolution, so the override is computed on
 * the spot from the model registry: a model added in Settings → Models gets
 * its ceiling without reopening anything. Raising `reserveTokens` moves the
 * blocking threshold down to the ceiling; background compaction still
 * starts `backgroundTokens` below it. A model whose window is already under
 * the ceiling keeps pi-durable's defaults, and a host's own override for a
 * model wins.
 */
import type { Models } from "@earendil-works/pi-ai/models";
import type { CompactionPolicy, CompactionSettings } from "@earendil-works/pi-durable";

/** Context size past which a chat is summarized, on every model. */
const CONTEXT_CEILING_TOKENS = 150_000;

/** pi-durable's default room kept free for the answer (`DEFAULT_COMPACTION_POLICY.reserveTokens`). */
const DEFAULT_RESERVE_TOKENS = 16_384;

type ModelLookup = Pick<Models, "getModel">;

/** The reserve that puts a model's blocking threshold at the ceiling, or undefined when its window is under it. */
function ceilingReserve(models: ModelLookup, key: string): number | undefined {
  const slash = key.indexOf("/");
  if (slash <= 0) return undefined;
  const model = models.getModel(key.slice(0, slash), key.slice(slash + 1));
  const window = model?.contextWindow ?? 0;
  const reserve = window - CONTEXT_CEILING_TOKENS;
  return reserve > DEFAULT_RESERVE_TOKENS ? reserve : undefined;
}

/** Compaction settings with the ceiling applied to every model the registry knows. */
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
