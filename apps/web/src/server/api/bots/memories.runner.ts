/**
 * The capture runner: turn an idle conversation into an extraction side-call.
 * Only owner turns are memory sources; assistant replies supply context.
 */
import { eq } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { stripAttachmentNotes } from "@tiny-agents/agent";
import {
  buildCapturePrompt,
  createMemoryCapture,
  parseExtraction,
  type MemoryCapture,
} from "./memories.capture";
import { MEMORY_CAPTURE_CHAR_CAP, MEMORY_TRIVIAL_BYTES } from "./memories.domain";
import { memoryLedger } from "./memories.ledger";
import { bots, db } from "../../db";
import { chatOwner } from "./bots.owner";
import type { SideCaller } from "./side-call";

const CAPTURE_TIMEOUT_MS = 60_000;
/**
 * An assistant reply is context for the owner's next words, never a source:
 * its opening (usually the question the owner answers) is enough, and replies
 * are most of a window's characters.
 */
const ASSISTANT_CONTEXT_CHARS = 500;

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
      entries.push({
        line: `Owner: ${text}`,
        ownerBytes: Buffer.byteLength(text, "utf8"),
      });
      latestOwnerAt = Math.max(latestOwnerAt, m.createdAt);
    } else if (m.role === "assistant" && m.status !== "error") {
      entries.push({
        line: `${botName}: ${text.slice(0, ASSISTANT_CONTEXT_CHARS)}`,
      });
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

export interface CaptureDeps {
  /** The side-caller; undefined (faux mode) means no capture. */
  sideCaller: SideCaller | undefined;
  readTranscript: (conversationId: number) => Promise<ReadonlyArray<CaptureMessage>>;
}

/** Run one capture for a conversation. Every failure is logged and swallowed. */
export async function captureConversation(
  conversationId: number,
  deps: CaptureDeps,
): Promise<void> {
  try {
    if (!deps.sideCaller) return;
    // Only a bot's own chat is captured: a routine's conversation holds the
    // routine's work, not the owner's facts (issue #63). A shared chat
    // (issue #145) holds other people's words too: its bot reads as memory off.
    const owner = await chatOwner(conversationId);
    if (!owner?.memoryEnabled) return;
    const bot = await db.query.bots.findFirst({
      where: eq(bots.id, owner.id),
      columns: {
        id: true,
        name: true,
        modelId: true,
        memoryCapturedThrough: true,
      },
    });
    if (!bot) return;
    const ledger = memoryLedger(bot.id);

    const messages = await deps.readTranscript(conversationId);
    const window = captureWindow(messages, bot.memoryCapturedThrough, bot.name);
    if (!window.through) return;
    if (window.ownerBytes < MEMORY_TRIVIAL_BYTES) {
      // Advance the watermark anyway: sub-trivial chatter must not pile up
      // into a later capture window it no longer relates to.
      await ledger.advanceWatermark(window.through);
      return;
    }

    // The prompt lists what the owner removed, so capture does not bring it
    // back reworded; the ledger's exact-text dedupe stays the hard rail.
    const context = await ledger.promptContext();
    const reply = await deps.sideCaller.complete({
      role: "memory_capture",
      ...(bot.modelId ? { botModelId: bot.modelId } : {}),
      system: buildCapturePrompt({
        botName: bot.name,
        transcript: window.lines.join("\n"),
        currentMemories: context.current,
        removedMemories: context.removed,
        today: new Date().toISOString().slice(0, 10),
      }),
      user: "Extract now.",
      timeoutMs: CAPTURE_TIMEOUT_MS,
      label: "Memory capture",
      context: { conversationId },
    });
    // No model, or the call failed (logged): a later settle retries the window.
    if (reply === undefined) return;
    const extraction = parseExtraction(reply);
    if (extraction === null) {
      logger.warn({ conversationId }, "Memory capture output unparseable; window will retry");
      return;
    }
    // The prompt named memories by short ref only: a ref maps to its row,
    // and anything else (a made-up id) supersedes nothing.
    const items = extraction.map((item) => ({
      ...item,
      supersedesIds:
        item.supersedesIds?.flatMap((ref) => (context.refs[ref] ? [context.refs[ref]] : [])) ??
        null,
    }));
    const { created, revived, superseded, skipped } = await ledger.add(items, {
      source: "capture",
      watermark: window.through,
      conversationId: String(conversationId),
    });
    logger.info(
      { conversationId, created, revived, superseded, skipped },
      "Memory capture complete",
    );
  } catch (error) {
    logger.warn({ error, conversationId }, "Memory capture skipped after error");
  }
}

/**
 * Memory capture as one settled step: the debounce (memories.capture.ts)
 * running `captureConversation` on this side-caller. What bots.settled.ts
 * wires; undefined without a side-caller (faux mode), so nothing is armed.
 */
export function memoryCaptureStep(
  sideCaller: SideCaller | undefined,
  readTranscript: CaptureDeps["readTranscript"],
): MemoryCapture | undefined {
  if (!sideCaller) return undefined;
  return createMemoryCapture({
    captureNow: (conversationId) =>
      captureConversation(conversationId, { sideCaller, readTranscript }),
  });
}
