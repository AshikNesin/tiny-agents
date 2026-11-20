import type { MutableModels } from "@earendil-works/pi-ai/models";
import { logger } from "@groot/core/logger";
import { secretRedactor } from "@tiny-agents/agent";
import type { ModelCatalog } from "@tiny-agents/models";
import { recordLlmCall, type LlmCallRecord } from "../traces/traces.calls";

export interface SideCallRuntime {
  catalog: Pick<ModelCatalog, "forRole" | "piModel">;
  models: Pick<MutableModels, "completeSimple">;
}

export interface SideCallRequest {
  role: "memory_capture" | "chat_title";
  botModelId?: string;
  system: string;
  user: string;
  timeoutMs: number;
  label: string;
  botId?: string;
  context?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface SideCaller {
  complete(request: SideCallRequest): Promise<string | undefined>;
}

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
