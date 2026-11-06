/**
 * Side-calls (GLOSSARY: Side-call): one-shot model calls the app makes off
 * the reply path (memory capture, Past chat titles). One module owns how
 * every one of them runs, so its rules hold in one place:
 *
 * - The model: an explicit override when the Model catalog can call it,
 *   else the bot's own model (a Claude plan bot's runs on the same model
 *   served by a registry provider, when one serves it).
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
import type { ModelCatalog } from "@tiny-agents/agent";

/** What a side-caller needs from the runtime: its Model catalog and the registry that calls models. */
export interface SideCallRuntime {
  catalog: Pick<ModelCatalog, "model">;
  models: Pick<MutableModels, "completeSimple">;
}

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

/** The model a call runs on: `override` when the catalog can call it, else the bot's model when it can. */
function modelFor(
  catalog: SideCallRuntime["catalog"],
  botModelId: string | undefined,
  override: string | undefined,
) {
  const explicit = override
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim();
  for (const modelId of [explicit, botModelId]) {
    const model = modelId ? catalog.model(modelId) : undefined;
    if (model) return { modelId, model };
  }
  return { modelId: explicit || botModelId, model: undefined };
}

const TIMED_OUT = Symbol("timed out");

export function createSideCaller(runtime: SideCallRuntime): SideCaller {
  return {
    async complete(request) {
      const { label } = request;
      const { modelId, model } = modelFor(runtime.catalog, request.botModelId, request.override);
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
