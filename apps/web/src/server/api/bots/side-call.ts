/**
 * Side-calls: one-shot model calls the app makes off the reply path (memory
 * capture, Past chat titles). They share how a model is picked: an explicit
 * override when the runtime knows it, else the bot's own model, resolved
 * against the registry the runtime opened with.
 */
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { GATEWAY_PROVIDER, type AgentRuntime } from "@tiny-agents/agent";

/** The minimum a side-call needs from the runtime's model registry. */
export type SideCallModels = Pick<MutableModels, "getModel" | "completeSimple">;

/**
 * The model id a side-call runs on: `override` when the runtime has it, else
 * the bot's model when the runtime has that; undefined means no call.
 * Quotes around an env value are tolerated.
 */
export function resolveSideCallModelId(
  runtime: Pick<AgentRuntime, "hasModel">,
  botModelId: string,
  override?: string,
): string | undefined {
  const explicit = override
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim();
  if (explicit && runtime.hasModel(explicit)) return explicit;
  return runtime.hasModel(botModelId) ? botModelId : undefined;
}

/**
 * The registry model behind an app model id: the primary provider's ids as
 * they are; other providers as "custom:<provider>/<model>" (the slash
 * inside the model id is theirs). `primary` is the runtime's provider.
 */
export function resolveSideCallModel(
  models: Pick<MutableModels, "getModel">,
  modelId: string,
  primary: string = GATEWAY_PROVIDER,
) {
  const customPrefix = "custom:";
  if (modelId.startsWith(customPrefix)) {
    const rest = modelId.slice(customPrefix.length);
    const slash = rest.indexOf("/");
    return slash > 0 ? models.getModel(rest.slice(0, slash), rest.slice(slash + 1)) : undefined;
  }
  return models.getModel(primary, modelId);
}
