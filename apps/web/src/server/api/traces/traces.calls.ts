/**
 * Side-call metadata (Traces, issue #363): one `llm_calls` row per one-shot
 * model call made outside a conversation. Only who, which model, tokens,
 * cost, duration and outcome: never the prompt or the answer. Writing one
 * prunes rows past the retention window, so the table stays small without a
 * job. A failed write is logged and dropped: tracing never fails the call.
 */
import { desc, lt } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import type { Usage } from "@earendil-works/pi-ai";
import { db, llmCalls, type LlmCall } from "../../db";

/** How long side-call rows are kept. */
const LLM_CALL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const ERROR_MAX = 200;

export interface LlmCallRecord {
  purpose: string;
  botId?: string | undefined;
  modelId?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  usage?: Partial<Usage> | undefined;
  durationMs?: number | undefined;
  outcome: LlmCall["outcome"];
  error?: string | undefined;
}

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

export async function recordLlmCall(call: LlmCallRecord): Promise<void> {
  try {
    const now = Date.now();
    await db.insert(llmCalls).values({
      purpose: call.purpose.slice(0, 60),
      botId: call.botId ?? null,
      modelId: call.modelId ?? null,
      provider: call.provider ?? null,
      model: call.model ?? null,
      inputTokens: count(call.usage?.input),
      outputTokens: count(call.usage?.output),
      cacheReadTokens: count(call.usage?.cacheRead),
      cacheWriteTokens: count(call.usage?.cacheWrite),
      costUsd: Number.isFinite(call.usage?.cost?.total) ? (call.usage?.cost?.total ?? 0) : 0,
      durationMs: call.durationMs === undefined ? null : Math.round(call.durationMs),
      outcome: call.outcome,
      error: call.error ? call.error.slice(0, ERROR_MAX) : null,
      createdAt: new Date(now),
    });
    await db.delete(llmCalls).where(lt(llmCalls.createdAt, new Date(now - LLM_CALL_RETENTION_MS)));
  } catch (error) {
    logger.warn({ error, purpose: call.purpose }, "Traces: could not record a side-call");
  }
}

/** Side-calls newest first, `limit` of them created before `before`. */
export async function listLlmCalls(options: { before?: number; limit: number }) {
  return db.query.llmCalls.findMany({
    where: options.before ? lt(llmCalls.createdAt, new Date(options.before)) : undefined,
    orderBy: [desc(llmCalls.createdAt)],
    limit: options.limit,
    with: { bot: { columns: { id: true, name: true } } },
  });
}
