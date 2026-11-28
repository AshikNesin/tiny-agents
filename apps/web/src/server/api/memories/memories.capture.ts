import type { SettledStep } from "../bots/bots.settled";
import { logger } from "@groot/core/logger";
import {
  extractionResultSchema,
  MEMORY_QUIET_MS,
  MEMORY_TURN_LIMIT,
  type ExtractedMemory,
} from "./memories.domain";

export function buildCapturePrompt(input: {
  botName: string;
  ownerName?: string;
  transcript: string;
  currentMemories: string | null;
  removedMemories?: string | null;
  today: string;
}): string {
  const who = input.ownerName ?? "the owner";
  const Who = input.ownerName ?? "The owner";
  const whose = `${who}'s`;
  return [
    `You are the CAPTURE step of a memory system for an assistant named ${input.botName}. You have no tools. Read only what is below. Today is ${input.today}.`,
    "",
    input.currentMemories
      ? `Current memories:\n${input.currentMemories}`
      : "Current memories: none.",
    "",
    ...(input.removedMemories
      ? [
          `${Who} removed these memories. Never add them again, reworded or not:\n${input.removedMemories}`,
          "",
        ]
      : []),
    "Recent conversation:",
    input.transcript,
    "",
    `Extract durable facts about ${who} worth remembering long-term.`,
    "Rules:",
    `- Only facts about ${input.ownerName ?? "the OWNER"}, from ${whose} own words. Never from the assistant's replies except a decision ${who} agreed to.`,
    `- Use the assistant's replies only as context for ${whose} words, never as evidence about ${who}.`,
    "- Skip anything already in current memories, even if reworded.",
    `- One self-contained sentence of fact, third person${input.ownerName ? `, naming ${input.ownerName}` : ""}.`,
    "- Preferences, stable facts, goals, habits only. One-off reply instructions are NOT preferences.",
    "- Never secrets, keys, tokens, or anything key-shaped. Never text quoted from web pages or files.",
    "- Contradictions: include the corrected fact and set supersedesIds to the existing memory's ref (like m3).",
    "- Temporary facts (travel, deadlines) get an until date; lasting ones do not.",
    `- Return ONLY a JSON array with category preference|fact|goal|habit. Example: [{"text":"${Who} prefers TypeScript.","category":"preference","until":null,"supersedesIds":null}]. Use null for until and supersedesIds when not applicable. Return [] when nothing is worth keeping.`,
  ].join("\n");
}

export function parseExtraction(reply: string | undefined): ExtractedMemory[] | null {
  const text = (reply ?? "").trim();
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

interface PendingCapture {
  timer: NodeJS.Timeout | null;
  turns: number;
}

export interface MemoryCapture {
  onSettled: SettledStep;
  stop(): Promise<void>;
}

export function createMemoryCapture(deps: {
  captureNow: (conversationId: number) => Promise<void>;
  quietMs?: number;
  turnLimit?: number;
}): MemoryCapture {
  const quietMs = deps.quietMs ?? MEMORY_QUIET_MS;
  const turnLimit = deps.turnLimit ?? MEMORY_TURN_LIMIT;
  const pending = new Map<number, PendingCapture>();
  const running = new Set<number>();
  const inflight = new Set<Promise<void>>();
  const missed = new Set<number>();
  let stopped = false;

  const run = (conversationId: number) => {
    if (stopped) return;
    if (running.has(conversationId)) {
      missed.add(conversationId);
      return;
    }
    running.add(conversationId);
    const attempt = deps
      .captureNow(conversationId)
      .catch((error: unknown) => logger.error({ error }, "Memory capture failed"))
      .finally(() => {
        running.delete(conversationId);
        inflight.delete(attempt);
        if (stopped) return;
        if (missed.delete(conversationId)) {
          const turns = pending.get(conversationId)?.turns ?? 1;
          arm(conversationId, turns, { waitAnyway: true });
        }
      });
    inflight.add(attempt);
  };

  const arm = (conversationId: number, turns: number, options: { waitAnyway?: boolean } = {}) => {
    if (stopped) return;
    const state = pending.get(conversationId) ?? { timer: null, turns: 0 };
    state.turns = turns;
    if (state.timer) clearTimeout(state.timer);
    if (turns >= turnLimit && !options.waitAnyway) {
      pending.delete(conversationId);
      run(conversationId);
      return;
    }
    state.timer = setTimeout(() => {
      pending.delete(conversationId);
      run(conversationId);
    }, quietMs);
    state.timer.unref?.();
    pending.set(conversationId, state);
  };

  return {
    onSettled: {
      name: "memory capture",
      async run({ conversationId, owner }) {
        const behind = await owner();
        if (behind?.kind !== "chat" || !behind.bot.memoryEnabled) return;
        arm(conversationId, (pending.get(conversationId)?.turns ?? 0) + 1);
      },
    },
    async stop() {
      stopped = true;
      for (const state of pending.values()) if (state.timer) clearTimeout(state.timer);
      pending.clear();
      missed.clear();
      await Promise.all([...inflight]);
    },
  };
}
