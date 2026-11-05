/**
 * Side-calls (GLOSSARY: Side-call): one-shot model calls the app makes off
 * the reply path (memory capture, Past chat titles). One module owns how
 * every one of them runs, so its rules hold in one place:
 *
 * - The model: an explicit override when the runtime knows it, else the
 *   bot's own model; ids of another provider than the runtime's primary are
 *   "custom:<provider>/<model>".
 * - The deadline: the call is aborted when it runs out (it must not keep
 *   spending tokens), and the caller gets its answer then even when the
 *   provider ignores the abort.
 * - Failure: a thrown error, an `error` or `aborted` stop, a timeout or no
 *   model at all are logged here and come back as `undefined`.
 * - The answer: the reply's text blocks, joined.
 *
 * Faux mode makes no side-calls: boot passes no side-caller there.
 */
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { logger } from "@groot/core/logger";
import { GATEWAY_PROVIDER, type AgentRuntime } from "@tiny-agents/agent";

/** What a side-caller needs from the runtime: its model registry and primary provider. */
export type SideCallRuntime = Pick<AgentRuntime, "hasModel"> & {
  models: Pick<MutableModels, "getModel" | "completeSimple">;
  provider?: string;
};

export interface SideCallRequest {
  /** The bot's model: the fallback when `override` is unset or unknown to the runtime. */
  botModelId?: string;
  /** An explicit model (an env setting), used when the runtime has it. Quotes are tolerated. */
  override?: string;
  system: string;
  user: string;
  timeoutMs: number;
  /** What the call is for, in logs ("Chat title", "Memory capture"). */
  label: string;
  /** Extra fields for the logs (a chat id, a conversation id). */
  context?: Record<string, unknown>;
  /** The caller's own cancel. */
  signal?: AbortSignal;
}

export interface SideCaller {
  /** The reply's text; `undefined` when there was no model or the call failed (already logged). */
  complete(request: SideCallRequest): Promise<string | undefined>;
}

/** The model id a call runs on: `override` when the runtime has it, else the bot's model when it has that. */
function modelIdFor(
  runtime: Pick<AgentRuntime, "hasModel">,
  botModelId: string | undefined,
  override: string | undefined,
): string | undefined {
  const explicit = override
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim();
  if (explicit && runtime.hasModel(explicit)) return explicit;
  return botModelId && runtime.hasModel(botModelId) ? botModelId : undefined;
}

/**
 * The registry model behind an app model id: the primary provider's ids as
 * they are; other providers as "custom:<provider>/<model>" (the slash
 * inside the model id is theirs).
 */
function registryModel(models: Pick<MutableModels, "getModel">, modelId: string, primary: string) {
  const customPrefix = "custom:";
  if (modelId.startsWith(customPrefix)) {
    const rest = modelId.slice(customPrefix.length);
    const slash = rest.indexOf("/");
    return slash > 0 ? models.getModel(rest.slice(0, slash), rest.slice(slash + 1)) : undefined;
  }
  return models.getModel(primary, modelId);
}

const TIMED_OUT = Symbol("timed out");

export function createSideCaller(runtime: SideCallRuntime): SideCaller {
  return {
    async complete(request) {
      const { label } = request;
      const modelId = modelIdFor(runtime, request.botModelId, request.override);
      const model = modelId
        ? registryModel(runtime.models, modelId, runtime.provider ?? GATEWAY_PROVIDER)
        : undefined;
      const fields = { ...request.context, label, modelId };
      if (!model) {
        logger.warn(fields, `${label}: no model available; skipped`);
        return undefined;
      }

      const controller = new AbortController();
      const signal = request.signal
        ? AbortSignal.any([controller.signal, request.signal])
        : controller.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => {
          controller.abort(new Error(`${label} timed out`));
          resolve(TIMED_OUT);
        }, request.timeoutMs);
      });
      try {
        const call = runtime.models.completeSimple(
          model,
          {
            systemPrompt: request.system,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: request.user }],
                timestamp: Date.now(),
              },
            ],
          },
          { signal },
        );
        // A late rejection after the deadline is nobody's concern.
        call.catch(() => undefined);
        const reply = await Promise.race([call, deadline]);
        if (reply === TIMED_OUT) {
          logger.warn({ ...fields, timeoutMs: request.timeoutMs }, `${label}: timed out`);
          return undefined;
        }
        if (reply.stopReason === "error" || reply.stopReason === "aborted") {
          logger.warn(
            { ...fields, stopReason: reply.stopReason, errorMessage: reply.errorMessage },
            `${label}: the model failed`,
          );
          return undefined;
        }
        return (reply.content ?? [])
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("\n");
      } catch (error) {
        logger.warn({ ...fields, error }, `${label}: the call failed`);
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
