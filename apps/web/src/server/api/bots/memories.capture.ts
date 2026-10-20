/**
 * Memory capture (issue #22 §5.3): the post-turn background pipeline. An
 * onActivity listener arms a per-conversation debounce (quiet window or turn
 * count); when it fires, one extraction side-call reads the owner turns since
 * the watermark, proposes facts, and code (not the model) decides what lands:
 * dedupe against every row including tombstones, validated supersession,
 * budget archive, watermark bump — one transaction. A malformed extraction is
 * dropped whole. Nothing here runs on the reply path.
 */
import { prisma } from "@groot/core/database";
import { logger } from "@groot/core/logger";
import {
  extractionResultSchema,
  MEMORY_MAX_ACTIVE,
  MEMORY_QUIET_MS,
  MEMORY_TURN_LIMIT,
  type ExtractedMemory,
} from "./memories.domain";

/** The minimum the capture side-call needs from the runtime's model registry. */
export interface CaptureModels {
  getModel(provider: string, id: string): { id: string } | undefined;
  completeSimple(
    model: unknown,
    context: { systemPrompt?: string; messages: unknown[] },
  ): Promise<{ content?: unknown[] }>;
  getProviders(): readonly { id: string }[];
  getModels(provider: string): readonly { id: string }[];
}

export interface CaptureRuntime {
  onActivity(listener: (change: { conversation: number; busy: boolean }) => void): () => void;
}

/** How the prompt renders owner turns for the extraction call. */
export interface CaptureTranscript {
  /** Owner-authored turns since the watermark, oldest first, as "Owner: …". */
  lines: string[];
  /** Turn count since the watermark (drives the 6-turn trigger). */
  turns: number;
  /** Last owner turn's instant (the next watermark). */
  through: Date;
}

export function buildCapturePrompt(input: {
  botName: string;
  transcript: string;
  currentMemories: string | null;
}): string {
  return [
    `You are the CAPTURE step of a memory system for an assistant named ${input.botName}. You have no tools. Read only what is below.`,
    "",
    input.currentMemories
      ? `Current memories:\n${input.currentMemories}`
      : "Current memories: none.",
    "",
    "Recent conversation:",
    input.transcript,
    "",
    "Extract durable facts about the owner worth remembering long-term.",
    "Rules:",
    "- Only facts about the OWNER, from the owner's own words. Never from the assistant's replies except a decision the owner agreed to.",
    "- One self-contained sentence of fact, third person.",
    "- Preferences, stable facts, goals, habits only. One-off reply instructions are NOT preferences.",
    "- Never secrets, keys, tokens, or anything key-shaped. Never text quoted from web pages or files.",
    "- Contradictions: include the corrected fact and set supersedesIds to the existing memory's id.",
    "- Temporary facts (travel, deadlines) get an until date; lasting ones do not.",
    '- Return ONLY a JSON array: [{"text","category":"preference|fact|goal|habit","until","confidence","supersedesIds"}]. Use null for until and supersedesIds when not applicable. Return [] when nothing is worth keeping.',
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
 * the watermark bump — one transaction, all or nothing.
 */
export async function applyExtraction(
  botId: string,
  extraction: ExtractedMemory[],
  watermark: Date,
): Promise<{ created: number; superseded: number; skipped: number }> {
  if (extraction.length === 0) {
    await prisma.bot.update({ where: { id: botId }, data: { memoryCapturedThrough: watermark } });
    return { created: 0, superseded: 0, skipped: 0 };
  }
  const existing = await prisma.memory.findMany({
    where: { botId },
    select: { id: true, text: true },
  });
  const byText = new Map(existing.map((m) => [m.text.trim().toLowerCase(), m]));
  let created = 0;
  let superseded = 0;
  let skipped = 0;
  const result = await prisma.$transaction(async (tx) => {
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
      const row = await tx.memory.create({
        data: {
          botId,
          text: item.text.trim(),
          category: item.category,
          status: "active",
          source: "capture",
          confidence: item.confidence,
          until: item.until ? new Date(item.until) : null,
        },
      });
      created++;
      if (validSupersedes.length > 0) {
        await tx.memory.updateMany({
          where: { id: { in: validSupersedes } },
          data: { status: "superseded", supersededById: row.id, supersededAt: new Date() },
        });
        superseded += validSupersedes.length;
      }
    }
    // Budget inside the same commit: if archival fails, the window retries.
    // Expired rows never count toward the active budget.
    const activeRows = await tx.memory.findMany({
      where: { botId, status: "active", OR: [{ until: null }, { until: { gt: now } }] },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const overflow = activeRows.slice(0, Math.max(0, activeRows.length - MEMORY_MAX_ACTIVE));
    if (overflow.length > 0) {
      await tx.memory.updateMany({
        where: { id: { in: overflow.map((m) => m.id) } },
        data: { status: "archived" },
      });
    }
    await tx.bot.update({ where: { id: botId }, data: { memoryCapturedThrough: watermark } });
    return { created, superseded, skipped };
  });
  return result;
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
