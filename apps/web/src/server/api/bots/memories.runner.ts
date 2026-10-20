/**
 * The capture runner: turn an idle conversation into an extraction side-call.
 * Skip rules run before any model call (memory off, no gateway/faux mode,
 * trivial window, no owner turns since the watermark). Owner turns only:
 * peer-tagged deliveries and routine fires are not memory sources.
 */
import { prisma } from "@groot/core/database";
import { logger } from "@groot/core/logger";
import { GATEWAY_PROVIDER, isGatewayConfigured } from "@tiny-agents/agent";
import type { AgentRuntime } from "@tiny-agents/agent";
import {
  buildCapturePrompt,
  parseExtraction,
  applyExtraction,
  type CaptureModels,
} from "./memories.capture";
import { MEMORY_TRIVIAL_BYTES } from "./memories.domain";

const CAPTURE_TIMEOUT_MS = 60_000;

interface OwnerWindow {
  lines: string[];
  turns: number;
  through: Date | null;
}

/** Owner-authored user turns since the watermark (peer sends excluded). */
export function ownerWindow(
  messages: ReadonlyArray<{ role: string; text: string; createdAt: number; peer?: unknown }>,
  watermark: Date | null,
): OwnerWindow {
  const since = watermark ? watermark.getTime() : 0;
  const lines: string[] = [];
  let turns = 0;
  let through: Date | null = null;
  for (const m of messages) {
    if (m.role !== "user" || m.peer) continue;
    if (m.createdAt <= since) continue;
    const text = m.text.trim();
    if (!text) continue;
    lines.push(`Owner: ${text}`);
    turns++;
    through = new Date(m.createdAt);
  }
  return { lines, turns, through };
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

function resolveCaptureModel(models: CaptureModels, modelId: string): unknown {
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
  /** Model id resolved through the registry; undefined = skip. */
  modelId: string | undefined;
}

/** Run one capture for a conversation. Every failure is logged and swallowed. */
export async function captureConversation(
  conversationId: number,
  deps: {
    sideCall: CaptureSideCall | undefined;
    readTranscript: (
      conversationId: number,
    ) => Promise<ReadonlyArray<{ role: string; text: string; createdAt: number; peer?: unknown }>>;
  },
): Promise<void> {
  try {
    const bot = await prisma.bot.findUnique({
      where: { conversationId: String(conversationId) },
      select: {
        id: true,
        name: true,
        memoryEnabled: true,
        memoryCapturedThrough: true,
        memories: { where: { status: "active" }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!bot || !bot.memoryEnabled) return;
    if (!deps.sideCall || !deps.sideCall.modelId) return;

    const messages = await deps.readTranscript(conversationId);
    const window = ownerWindow(messages, bot.memoryCapturedThrough);
    if (!window.through) return;
    const bytes = Buffer.byteLength(window.lines.join("\n"), "utf8");
    if (bytes < MEMORY_TRIVIAL_BYTES) {
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
    });
    const model = resolveCaptureModel(deps.sideCall.models, deps.sideCall.modelId);
    if (!model) return;
    const reply = await withTimeout(
      deps.sideCall.models.completeSimple(model, {
        systemPrompt: prompt,
        messages: [{ role: "user", content: [{ type: "text", text: "Extract now." }] }],
      }),
      CAPTURE_TIMEOUT_MS,
    );
    const extraction = parseExtraction(reply as { content?: unknown[] });
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

/** Resolve the capture model: MEMORY_CAPTURE_MODEL, else the gateway default. */
export function resolveCaptureModelId(
  runtime: Pick<AgentRuntime, "models" | "hasModel">,
  env: Readonly<Record<string, string | undefined>> = process.env,
  gatewayConfigured = isGatewayConfigured(env),
): string | undefined {
  if (!gatewayConfigured) return undefined;
  const explicit = env.MEMORY_CAPTURE_MODEL?.trim();
  if (explicit && runtime.hasModel(explicit)) return explicit;
  return explicit ? undefined : "gpt-5.6-terra";
}
