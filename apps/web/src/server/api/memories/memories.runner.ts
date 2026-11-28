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
import { chatOwner } from "../bots/bots.owner";
import { ownerDisplayName } from "../people/people.service";
import type { SideCaller } from "../bots/side-call";

const CAPTURE_TIMEOUT_MS = 60_000;
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

export function captureWindow(
  messages: ReadonlyArray<CaptureMessage>,
  watermark: Date | null,
  botName: string,
  ownerName?: string,
): CaptureWindow {
  const since = watermark ? watermark.getTime() : 0;
  const entries: { line: string; at: number; ownerBytes?: number }[] = [];
  let latestOwnerAt = since;
  let ownerExchange = false;
  for (const m of messages) {
    if (m.role === "user") ownerExchange = !m.peer;
    if (!ownerExchange) continue;
    if (m.createdAt <= since) continue;
    const text = (m.role === "user" ? stripAttachmentNotes(m.text) : m.text).trim();
    if (!text) continue;
    if (m.role === "user") {
      entries.push({
        line: `${ownerName ?? "Owner"}: ${text}`,
        at: m.createdAt,
        ownerBytes: Buffer.byteLength(text, "utf8"),
      });
      latestOwnerAt = Math.max(latestOwnerAt, m.createdAt);
    } else if (m.role === "assistant" && m.status !== "error") {
      entries.push({
        line: `${botName}: ${text.slice(0, ASSISTANT_CONTEXT_CHARS)}`,
        at: m.createdAt,
      });
    }
  }
  const owned = entries.some((entry) => entry.ownerBytes !== undefined);
  const kept: typeof entries = [];
  let size = 0;
  let capped = false;
  for (const entry of entries) {
    size += entry.line.length + 1;
    if (size > MEMORY_CAPTURE_CHAR_CAP && kept.length > 0) {
      capped = true;
      break;
    }
    kept.push(entry);
  }
  const owner = kept.filter((entry) => entry.ownerBytes !== undefined);
  return {
    lines: kept.map((entry) => entry.line),
    turns: owner.length,
    ownerBytes: owner.reduce((sum, entry) => sum + (entry.ownerBytes ?? 0), 0),
    through: owned ? new Date(capped ? kept[kept.length - 1].at : latestOwnerAt) : null,
  };
}

export interface CaptureDeps {
  sideCaller: SideCaller | undefined;
  readTranscript: (conversationId: number) => Promise<ReadonlyArray<CaptureMessage>>;
}

export async function captureConversation(
  conversationId: number,
  deps: CaptureDeps,
): Promise<void> {
  try {
    if (!deps.sideCaller) return;
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
    const ownerName = await ownerDisplayName();
    if (ownerName) await ledger.nameOwner(ownerName);
    const window = captureWindow(messages, bot.memoryCapturedThrough, bot.name, ownerName);
    if (!window.through) return;
    if (window.ownerBytes < MEMORY_TRIVIAL_BYTES) {
      await ledger.advanceWatermark(window.through);
      return;
    }

    const context = await ledger.promptContext();
    const reply = await deps.sideCaller.complete({
      role: "memory_capture",
      ...(bot.modelId ? { botModelId: bot.modelId } : {}),
      system: buildCapturePrompt({
        botName: bot.name,
        ownerName,
        transcript: window.lines.join("\n"),
        currentMemories: context.current,
        removedMemories: context.removed,
        today: new Date().toISOString().slice(0, 10),
      }),
      user: "Extract now.",
      timeoutMs: CAPTURE_TIMEOUT_MS,
      label: "Memory capture",
      botId: bot.id,
      context: { conversationId },
    });
    if (reply === undefined) return;
    const extraction = parseExtraction(reply);
    if (extraction === null) {
      logger.warn({ conversationId }, "Memory capture output unparseable; window will retry");
      return;
    }
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
