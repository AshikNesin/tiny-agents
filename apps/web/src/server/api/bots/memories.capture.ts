/**
 * Memory capture (issue #22 §5.3): the post-turn background pipeline. An
 * onActivity listener arms a per-conversation debounce (quiet window or turn
 * count); when it fires, one extraction side-call reads the owner turns since
 * the watermark, proposes facts, and code (not the model) decides what lands:
 * dedupe against every row including tombstones, validated supersession,
 * budget archive, watermark bump — one transaction. A malformed extraction is
 * dropped whole. Nothing here runs on the reply path.
 */
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import {
  extractionResultSchema,
  MEMORY_MAX_ACTIVE,
  MEMORY_QUIET_MS,
  MEMORY_TURN_LIMIT,
  type ExtractedMemory,
} from "./memories.domain";
import { bots, db, memories, type AppDatabase } from "../../db";

/** The minimum the capture side-call needs from the runtime's model registry. */
export type CaptureModels = Pick<MutableModels, "getModel" | "completeSimple">;

export interface CaptureRuntime {
  onActivity(listener: (change: { conversation: number; busy: boolean }) => void): () => void;
}

export function buildCapturePrompt(input: {
  botName: string;
  transcript: string;
  currentMemories: string | null;
  /** Memories the owner deleted, newest first: never re-added, even reworded. */
  removedMemories?: string | null;
  today: string;
}): string {
  return [
    `You are the CAPTURE step of a memory system for an assistant named ${input.botName}. You have no tools. Read only what is below. Today is ${input.today}.`,
    "",
    input.currentMemories
      ? `Current memories:\n${input.currentMemories}`
      : "Current memories: none.",
    "",
    ...(input.removedMemories
      ? [
          `The owner removed these memories. Never add them again, reworded or not:\n${input.removedMemories}`,
          "",
        ]
      : []),
    "Recent conversation:",
    input.transcript,
    "",
    "Extract durable facts about the owner worth remembering long-term.",
    "Rules:",
    "- Only facts about the OWNER, from the owner's own words. Never from the assistant's replies except a decision the owner agreed to.",
    "- Use the assistant's replies only as context for the owner's words, never as evidence about the owner.",
    "- Skip anything already in current memories, even if reworded.",
    "- One self-contained sentence of fact, third person.",
    "- Preferences, stable facts, goals, habits only. One-off reply instructions are NOT preferences.",
    "- Never secrets, keys, tokens, or anything key-shaped. Never text quoted from web pages or files.",
    "- Contradictions: include the corrected fact and set supersedesIds to the existing memory's id.",
    "- Temporary facts (travel, deadlines) get an until date; lasting ones do not.",
    '- Return ONLY a JSON array with category preference|fact|goal|habit and numeric confidence 0..1. Example: [{"text":"The owner prefers TypeScript.","category":"preference","until":null,"confidence":0.9,"supersedesIds":null}]. Use null for until and supersedesIds when not applicable. Return [] when nothing is worth keeping.',
  ].join("\n");
}

/**
 * Parse the side-call reply: first text block, JSON array, validated whole.
 * Null means unparseable — distinct from a valid empty extraction, so the
 * caller leaves the watermark alone and the window retries later.
 */
export function parseExtraction(
  reply: { content?: unknown[] } | undefined,
): ExtractedMemory[] | null {
  const text = (reply?.content ?? [])
    .filter(
      (b): b is { type: string; text?: string } =>
        typeof b === "object" && b !== null && "type" in (b as object),
    )
    .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
    .join("\n")
    .trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    const result = extractionResultSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Apply an extraction in code. Returns the writes made. The model proposes;
 * these rails decide: exact-text dedupe against ALL rows (tombstones
 * included), supersession validated to same-bot rows, budget archive, and
 * the optional capture watermark bump — one transaction, all or nothing.
 * Chat-side saves omit the watermark so background capture still sees the turn.
 */
export async function applyExtraction(
  botId: string,
  extraction: ExtractedMemory[],
  watermark?: Date,
): Promise<{ created: number; superseded: number; skipped: number }> {
  if (extraction.length === 0) {
    if (watermark) setWatermark(db, botId, watermark);
    return { created: 0, superseded: 0, skipped: 0 };
  }
  let created = 0;
  let superseded = 0;
  let skipped = 0;
  // better-sqlite3 transactions are synchronous: every query runs inside it.
  const result = db.transaction((tx) => {
    const existing = tx
      .select({ id: memories.id, text: memories.text })
      .from(memories)
      .where(eq(memories.botId, botId))
      .all();
    const byText = new Map(existing.map((m) => [m.text.trim().toLowerCase(), m]));
    const now = new Date();
    const seen = new Set<string>();
    for (const item of extraction) {
      const key = item.text.trim().toLowerCase();
      if (byText.has(key) || seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      const validSupersedes = (item.supersedesIds ?? []).filter((sid) =>
        existing.some((m) => m.id === sid),
      );
      const row = tx
        .insert(memories)
        .values({
          botId,
          text: item.text.trim(),
          category: item.category,
          status: "active",
          source: "capture",
          confidence: item.confidence,
          until: item.until ? new Date(item.until) : null,
        })
        .returning({ id: memories.id })
        .get();
      created++;
      if (validSupersedes.length > 0) {
        tx.update(memories)
          .set({ status: "superseded", supersededById: row.id, supersededAt: new Date() })
          .where(inArray(memories.id, validSupersedes))
          .run();
        superseded += validSupersedes.length;
      }
    }
    // Budget inside the same commit: if archival fails, the window retries.
    // Expired rows never count toward the active budget.
    const activeRows = tx
      .select({ id: memories.id })
      .from(memories)
      .where(
        and(
          eq(memories.botId, botId),
          eq(memories.status, "active"),
          or(isNull(memories.until), gt(memories.until, now)),
        ),
      )
      .orderBy(asc(memories.createdAt))
      .all();
    const overflow = activeRows.slice(0, Math.max(0, activeRows.length - MEMORY_MAX_ACTIVE));
    if (overflow.length > 0) {
      tx.update(memories)
        .set({ status: "archived" })
        .where(
          inArray(
            memories.id,
            overflow.map((m) => m.id),
          ),
        )
        .run();
    }
    if (watermark) setWatermark(tx, botId, watermark);
    return { created, superseded, skipped };
  });
  return result;
}

/** Bump the capture watermark; a missing bot throws (and rolls back a surrounding transaction). */
function setWatermark(handle: Pick<AppDatabase, "update">, botId: string, watermark: Date): void {
  const { changes } = handle
    .update(bots)
    .set({ memoryCapturedThrough: watermark })
    .where(eq(bots.id, botId))
    .run();
  if (changes === 0) throw Boom.notFound("Bot not found");
}

interface PendingCapture {
  timer: NodeJS.Timeout | null;
  turns: number;
}

/**
 * The activity-feed listener. Arms a debounce per conversation; the quiet
 * window pushes back on every turn and the turn limit forces a capture.
 * Losing a pending timer to a restart costs latency, never facts: the
 * watermark only advances on committed captures.
 */
export function startMemoryCapture(
  runtime: CaptureRuntime,
  deps: {
    models: CaptureModels | undefined;
    captureNow: (conversationId: number) => Promise<void>;
    quietMs?: number;
    turnLimit?: number;
  },
): () => void {
  const quietMs = deps.quietMs ?? MEMORY_QUIET_MS;
  const turnLimit = deps.turnLimit ?? MEMORY_TURN_LIMIT;
  const pending = new Map<number, PendingCapture>();
  // One capture per conversation at a time: overlapping captures could both
  // pass dedupe against the same rows and an older run could overwrite a
  // newer watermark.
  const inflight = new Set<number>();

  const run = (conversationId: number) => {
    if (inflight.has(conversationId)) return;
    inflight.add(conversationId);
    void deps
      .captureNow(conversationId)
      .catch((error: unknown) => logger.error({ error }, "Memory capture failed"))
      .finally(() => inflight.delete(conversationId));
  };

  const arm = (conversationId: number, turns: number) => {
    const state = pending.get(conversationId) ?? { timer: null, turns: 0 };
    state.turns = turns;
    if (state.timer) clearTimeout(state.timer);
    if (turns >= turnLimit) {
      pending.set(conversationId, { timer: null, turns: 0 });
      run(conversationId);
      return;
    }
    state.timer = setTimeout(() => {
      pending.set(conversationId, { timer: null, turns: 0 });
      run(conversationId);
    }, quietMs);
    pending.set(conversationId, state);
  };

  const stop = runtime.onActivity((change) => {
    if (change.busy) return;
    arm(change.conversation, (pending.get(change.conversation)?.turns ?? 0) + 1);
  });

  return () => {
    stop();
    for (const state of pending.values()) if (state.timer) clearTimeout(state.timer);
    pending.clear();
  };
}
