/**
 * Side-calls (GLOSSARY: Side-call): one-shot model calls the app makes off
 * the reply path (memory capture, Past chat titles). One module owns how
 * every one of them runs, so its rules hold in one place:
 *
 * - The model: the call's model role (issue #179), set in Settings →
 *   Models; unset, the bot's own model when it runs on pi, else the
 *   `bot_default` role (`ModelCatalog.forRole`).
 * - The deadline: the call is aborted when it runs out (it must not keep
 *   spending tokens), and the caller gets its answer then even when the
 *   provider ignores the abort.
 * - Failure: a thrown error, an `error` or `aborted` stop, a timeout or no
 *   model at all are logged here and come back as `undefined`.
 * - The answer: the reply's text blocks, joined.
 * - What it sends: the prompt and the user text pass the secret redactor
 *   first, as tool results and logs do, so a vault value that reached a
 *   transcript or a memory never travels on to a side model.
 *
 * - The trace: every call that reached a model leaves one metadata row
 *   (`llm_calls`, Traces): model, tokens, cost, duration and outcome, never
 *   the prompt or the answer.
 *
 * Faux mode makes no side-calls: boot passes no side-caller there.
 */
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { logger } from "@groot/core/logger";
import { secretRedactor } from "@tiny-agents/agent";
import type { ModelCatalog } from "@tiny-agents/models";
import { recordLlmCall, type LlmCallRecord } from "../traces/traces.calls";

/** What a side-caller needs from the runtime: its Model catalog and the registry that calls models. */
export interface SideCallRuntime {
  catalog: Pick<ModelCatalog, "forRole" | "piModel">;
  models: Pick<MutableModels, "completeSimple">;
}

export interface SideCallRequest {
  /** The model role the call reads its model from. */
  role: "memory_capture" | "chat_title";
  /** The bot's model: the role's fallback when it isn't set. */
  botModelId?: string;
  system: string;
  user: string;
  timeoutMs: number;
  /** What the call is for, in logs and Traces ("Chat title", "Memory capture"). */
  label: string;
  /** The bot the call runs for, when there is one (Traces). */
  botId?: string;
  /** Extra fields for the logs (a chat id, a conversation id). */
  context?: Record<string, unknown>;
  /** The caller's own cancel. */
  signal?: AbortSignal;
}

export interface SideCaller {
  /** The reply's text; `undefined` when there was no model or the call failed (already logged). */
  complete(request: SideCallRequest): Promise<string | undefined>;
}

/** The model a call runs on: its role's model, as the catalog resolves it. */
function modelFor(
  catalog: SideCallRuntime["catalog"],
  role: SideCallRequest["role"],
  botModelId: string | undefined,
) {
  const chosen = catalog.forRole(role, botModelId ? { bot: botModelId } : {});
  return { modelId: chosen?.id, model: chosen ? catalog.piModel(chosen.id) : undefined };
}

const TIMED_OUT = Symbol("timed out");

export function createSideCaller(runtime: SideCallRuntime): SideCaller {
  return {
    async complete(request) {
      const { label } = request;
      const { modelId, model } = modelFor(runtime.catalog, request.role, request.botModelId);
      const fields = { ...request.context, label, modelId };
      if (!model) {
        logger.warn(fields, `${label}: no model available; skipped`);
        return undefined;
      }

      const startedAt = performance.now();
      const trace = (call: Omit<LlmCallRecord, "purpose">) =>
        recordLlmCall({
          purpose: label,
          botId: request.botId,
          modelId,
          provider: model.provider,
          model: model.id,
          durationMs: performance.now() - startedAt,
          ...call,
        });
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
            systemPrompt: secretRedactor.scrub(request.system),
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: secretRedactor.scrub(request.user) }],
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
          await trace({ outcome: "timeout" });
          logger.warn({ ...fields, timeoutMs: request.timeoutMs }, `${label}: timed out`);
          return undefined;
        }
        const failed = reply.stopReason === "error" || reply.stopReason === "aborted";
        await trace({
          usage: reply.usage,
          outcome: reply.stopReason === "aborted" ? "aborted" : failed ? "error" : "ok",
          error: reply.errorMessage,
        });
        if (failed) {
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
        await trace({
          outcome: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        logger.warn({ ...fields, error }, `${label}: the call failed`);
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
