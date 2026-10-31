/**
 * The capture runner: turn an idle conversation into an extraction side-call.
 * Only owner turns are memory sources; assistant replies supply context.
 */
import { and, desc, eq } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { GATEWAY_PROVIDER, stripAttachmentNotes } from "@tiny-agents/agent";
import type { AgentRuntime } from "@tiny-agents/agent";
import {
  buildCapturePrompt,
  parseExtraction,
  applyExtraction,
  type CaptureModels,
} from "./memories.capture";
import {
  MEMORY_CAPTURE_CHAR_CAP,
  MEMORY_REMOVED_IN_PROMPT,
  MEMORY_TRIVIAL_BYTES,
} from "./memories.domain";
import { bots, db, memories } from "../../db";
import { chatOwner } from "./bots.owner";

const CAPTURE_TIMEOUT_MS = 60_000;

interface CaptureWindow {
  lines: string[];
  turns: number;
  ownerBytes: number;
  through: Date | null;
}

interface CaptureMessage {
  role: string;
  text: string;
  createdAt: number;
  peer?: unknown;
  status?: string;
}

/**
 * The transcript one capture reads: owner turns (and the replies to them)
 * after the watermark, capped to the newest `MEMORY_CAPTURE_CHAR_CAP`
 * characters of whole lines. `through` is still the window's end, so a long
 * or never-captured history advances past what the cap left out instead of
 * retrying an oversized call forever.
 */
export function captureWindow(
  messages: ReadonlyArray<CaptureMessage>,
  watermark: Date | null,
  botName: string,
): CaptureWindow {
  const since = watermark ? watermark.getTime() : 0;
  const entries: { line: string; ownerBytes?: number }[] = [];
  let latestOwnerAt = since;
  let ownerExchange = false;
  for (const m of messages) {
    // Routine runs live in conversations of their own (issue #63), never here.
    if (m.role === "user") ownerExchange = !m.peer;
    if (!ownerExchange) continue;
    if (m.createdAt <= since) continue;
    // Owner turns without attached files' text (issue #58): file content is
    // never a source of memories.
    const text = (m.role === "user" ? stripAttachmentNotes(m.text) : m.text).trim();
    if (!text) continue;
    if (m.role === "user") {
      entries.push({ line: `Owner: ${text}`, ownerBytes: Buffer.byteLength(text, "utf8") });
      latestOwnerAt = Math.max(latestOwnerAt, m.createdAt);
    } else if (m.role === "assistant" && m.status !== "error") {
      entries.push({ line: `${botName}: ${text.slice(0, 1_500)}` });
    }
  }
  const owned = entries.some((entry) => entry.ownerBytes !== undefined);
  const kept: typeof entries = [];
  let size = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    size += entries[i].line.length + 1;
    if (size > MEMORY_CAPTURE_CHAR_CAP && kept.length > 0) break;
    kept.unshift(entries[i]);
  }
  const owner = kept.filter((entry) => entry.ownerBytes !== undefined);
  return {
    lines: kept.map((entry) => entry.line),
    turns: owner.length,
    ownerBytes: owner.reduce((sum, entry) => sum + (entry.ownerBytes ?? 0), 0),
    through: owned ? new Date(latestOwnerAt) : null,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Memory capture timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function resolveCaptureModel(models: CaptureModels, modelId: string) {
  const customPrefix = "custom:";
  if (modelId.startsWith(customPrefix)) {
    const rest = modelId.slice(customPrefix.length);
    const slash = rest.indexOf("/");
    return slash > 0 ? models.getModel(rest.slice(0, slash), rest.slice(slash + 1)) : undefined;
  }
  return models.getModel(GATEWAY_PROVIDER, modelId);
}

export interface CaptureSideCall {
  models: CaptureModels;
  hasModel: AgentRuntime["hasModel"];
  /** Optional override; otherwise capture uses the bot's own model. */
  modelId?: string;
}

/** Run one capture for a conversation. Every failure is logged and swallowed. */
export async function captureConversation(
  conversationId: number,
  deps: {
    sideCall: CaptureSideCall | undefined;
    readTranscript: (conversationId: number) => Promise<ReadonlyArray<CaptureMessage>>;
  },
): Promise<void> {
  try {
    // Only a bot's own chat is captured: a routine's conversation holds the
    // routine's work, not the owner's facts (issue #63).
    const owner = await chatOwner(conversationId);
    if (!owner) return;
    const bot = await db.query.bots.findFirst({
      where: eq(bots.id, owner.id),
      columns: {
        id: true,
        name: true,
        modelId: true,
        memoryEnabled: true,
        memoryCapturedThrough: true,
      },
      with: {
        memories: {
          where: (m, { eq }) => eq(m.status, "active"),
          orderBy: (m, { asc }) => [asc(m.createdAt)],
        },
      },
    });
    if (!bot || !bot.memoryEnabled) return;
    if (!deps.sideCall) return;
    const modelId = resolveCaptureModelId(deps.sideCall, bot.modelId, deps.sideCall.modelId);
    const model = modelId ? resolveCaptureModel(deps.sideCall.models, modelId) : undefined;
    if (!model) {
      logger.warn(
        { conversationId, modelId },
        "Memory capture model unavailable; window will retry",
      );
      return;
    }

    const messages = await deps.readTranscript(conversationId);
    const window = captureWindow(messages, bot.memoryCapturedThrough, bot.name);
    if (!window.through) return;
    if (window.ownerBytes < MEMORY_TRIVIAL_BYTES) {
      // Advance the watermark anyway: sub-trivial chatter must not pile up
      // into a later capture window it no longer relates to.
      await db
        .update(bots)
        .set({ memoryCapturedThrough: window.through })
        .where(eq(bots.id, bot.id));
      return;
    }

    const current = bot.memories
      .map(
        (m) =>
          `- ${m.id} — ${m.text}${m.until ? ` (until ${m.until.toISOString().slice(0, 10)})` : ""}`,
      )
      .join("\n");
    // The owner removed these: capture must not bring them back reworded
    // (exact-text dedupe in applyExtraction stays the hard rail).
    const removed = await db
      .select({ text: memories.text })
      .from(memories)
      .where(and(eq(memories.botId, bot.id), eq(memories.status, "deleted")))
      .orderBy(desc(memories.updatedAt))
      .limit(MEMORY_REMOVED_IN_PROMPT);
    const prompt = buildCapturePrompt({
      botName: bot.name,
      transcript: window.lines.join("\n"),
      currentMemories: current,
      removedMemories: removed.map((m) => `- ${m.text}`).join("\n") || null,
      today: new Date().toISOString().slice(0, 10),
    });
    const reply = await withTimeout(
      deps.sideCall.models.completeSimple(model, {
        systemPrompt: prompt,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Extract now." }],
            timestamp: Date.now(),
          },
        ],
      }),
      CAPTURE_TIMEOUT_MS,
    );
    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      logger.warn(
        { conversationId, modelId, stopReason: reply.stopReason, errorMessage: reply.errorMessage },
        "Memory capture model failed; window will retry",
      );
      return;
    }
    const extraction = parseExtraction(reply);
    if (extraction === null) {
      logger.warn({ conversationId }, "Memory capture output unparseable; window will retry");
      return;
    }
    const result = await applyExtraction(bot.id, extraction, window.through);
    logger.info({ conversationId, ...result }, "Memory capture complete");
  } catch (error) {
    logger.warn({ error, conversationId }, "Memory capture skipped after error");
  }
}

/** A bad override must not strand a bot whose own model still works. */
export function resolveCaptureModelId(
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
