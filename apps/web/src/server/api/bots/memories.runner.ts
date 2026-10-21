/**
 * The capture runner: turn an idle conversation into an extraction side-call.
 * Only owner turns are memory sources; assistant replies supply context.
 */
import { prisma } from "@groot/core/database";
import { logger } from "@groot/core/logger";
import { GATEWAY_PROVIDER } from "@tiny-agents/agent";
import type { AgentRuntime } from "@tiny-agents/agent";
import {
  buildCapturePrompt,
  parseExtraction,
  applyExtraction,
  type CaptureModels,
} from "./memories.capture";
import { MEMORY_TRIVIAL_BYTES } from "./memories.domain";

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

export function captureWindow(
  messages: ReadonlyArray<CaptureMessage>,
  watermark: Date | null,
  botName: string,
): CaptureWindow {
  const since = watermark ? watermark.getTime() : 0;
  const lines: string[] = [];
  let turns = 0;
  let ownerBytes = 0;
  let latestOwnerAt = since;
  let ownerExchange = false;
  for (const m of messages) {
    if (m.role === "user") {
      // Routine submissions predate trusted origin metadata and use this label.
      ownerExchange = !m.peer && !m.text.startsWith('**Routine "');
    }
    if (!ownerExchange) continue;
    if (m.createdAt <= since) continue;
    const text = m.text.trim();
    if (!text) continue;
    if (m.role === "user") {
      lines.push(`Owner: ${text}`);
      turns++;
      ownerBytes += Buffer.byteLength(text, "utf8");
      latestOwnerAt = Math.max(latestOwnerAt, m.createdAt);
    } else if (m.role === "assistant" && m.status !== "error") {
      lines.push(`${botName}: ${text.slice(0, 1_500)}`);
    }
  }
  return { lines, turns, ownerBytes, through: turns > 0 ? new Date(latestOwnerAt) : null };
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

function resolveCaptureModel(models: CaptureModels, modelId: string) {
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
    const bot = await prisma.bot.findUnique({
      where: { conversationId: String(conversationId) },
      select: {
        id: true,
        name: true,
        modelId: true,
        memoryEnabled: true,
        memoryCapturedThrough: true,
        memories: { where: { status: "active" }, orderBy: { createdAt: "asc" } },
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
      await prisma.bot.update({
        where: { id: bot.id },
        data: { memoryCapturedThrough: window.through },
      });
      return;
    }

    const current = bot.memories
      .map(
        (m) =>
          `- ${m.id} — ${m.text}${m.until ? ` (until ${m.until.toISOString().slice(0, 10)})` : ""}`,
      )
      .join("\n");
    const prompt = buildCapturePrompt({
      botName: bot.name,
      transcript: window.lines.join("\n"),
      currentMemories: current,
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
