/**
 * Memory capture (issue #22 §5.3): the post-turn background pipeline. Each
 * settled Turn of a bot's own chat arms a per-conversation debounce (quiet
 * window or turn count); when it fires, one extraction side-call reads the
 * owner turns since the watermark and proposes facts, and the memory ledger
 * (memories.ledger.ts), not the model, decides what lands. A malformed
 * extraction is dropped whole. Nothing here runs on the reply path.
 */
import type { SettledStep } from "./bots.settled";
import { logger } from "@groot/core/logger";
import {
  extractionResultSchema,
  MEMORY_QUIET_MS,
  MEMORY_TURN_LIMIT,
  type ExtractedMemory,
} from "./memories.domain";

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
 * Parse the side-call's text: a JSON array, validated whole. Null means
 * unparseable — distinct from a valid empty extraction, so the caller leaves
 * the watermark alone and the window retries later.
 */
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
  /** The settled step: each finished Turn arms the conversation's capture window. */
  onSettled: SettledStep;
  stop(): void;
}

/**
 * Memory capture's debounce (issue #22 phase B). Every settled Turn pushes a
 * per-conversation quiet window back; the window, or the turn limit, runs
 * one capture. One capture runs per conversation at a time: Turns that
 * settle meanwhile keep counting and re-arm the window once it is done, so
 * none is lost. Losing a pending timer to a restart costs latency, never
 * facts: the watermark only advances on committed captures.
 */
export function createMemoryCapture(deps: {
  captureNow: (conversationId: number) => Promise<void>;
  quietMs?: number;
  turnLimit?: number;
}): MemoryCapture {
  const quietMs = deps.quietMs ?? MEMORY_QUIET_MS;
  const turnLimit = deps.turnLimit ?? MEMORY_TURN_LIMIT;
  const pending = new Map<number, PendingCapture>();
  const inflight = new Set<number>();
  /** Conversations that settled again while their capture ran. */
  const missed = new Set<number>();

  const run = (conversationId: number) => {
    if (inflight.has(conversationId)) {
      missed.add(conversationId);
      return;
    }
    inflight.add(conversationId);
    void deps
      .captureNow(conversationId)
      .catch((error: unknown) => logger.error({ error }, "Memory capture failed"))
      .finally(() => {
        inflight.delete(conversationId);
        if (missed.delete(conversationId)) {
          // The Turns that settled meanwhile wait for the quiet window again.
          const turns = pending.get(conversationId)?.turns ?? 1;
          arm(conversationId, turns, { waitAnyway: true });
        }
      });
  };

  const arm = (conversationId: number, turns: number, options: { waitAnyway?: boolean } = {}) => {
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
    pending.set(conversationId, state);
  };

  return {
    onSettled: {
      name: "memory capture",
      async run({ conversationId, owner }) {
        // Only a bot's own chat, with memory on, is a source (the capture
        // re-checks when it runs: the switch may flip meanwhile).
        const behind = await owner();
        if (behind?.kind !== "chat" || !behind.bot.memoryEnabled) return;
        arm(conversationId, (pending.get(conversationId)?.turns ?? 0) + 1);
      },
    },
    stop() {
      for (const state of pending.values()) if (state.timer) clearTimeout(state.timer);
      pending.clear();
    },
  };
}
