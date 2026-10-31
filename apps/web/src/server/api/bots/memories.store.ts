/**
 * MemoryStore adapter: the agent's `memory` capability reads the bot's
 * injectable memories from app.db. Dependency direction stays one-way —
 * `@tiny-agents/agent` defines the port, apps/web implements it.
 *
 * Ordering matches memories.domain.ts exactly (fixed category order, then
 * createdAt ascending) so the rendered block is deterministic for the
 * provider's prompt cache.
 *
 * Writes from chat (`remember`, `forget`) happen only in the owner's own
 * turns: a routine run or another bot's message is refused even when the
 * owner set the tool to Always allow, since a planted memory would reach
 * every later prompt.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, memories } from "../../db";
import {
  CATEGORY_ORDER,
  extractedMemorySchema,
  isExpired,
  type MemoryCategory,
} from "./memories.domain";
import { applyExtraction } from "./memories.capture";
import { getAgentRuntime } from "./bots.runtime";
import { conversationOwner, isUnattended, type ChatReader } from "./bots.owner";
import type { MemoryLine, MemoryStore } from "@tiny-agents/agent";

function order(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category as MemoryCategory);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

/** Words too common in memories to pick one out (every memory is about the owner). */
const GENERIC_WORDS = new Set(
  "a an and are as at about be for i in is it me my of on or owner owner's owners that the this to was with".split(
    " ",
  ),
);

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

export function createMemoryStore(
  runtime: () => ChatReader = () => getAgentRuntime(),
): MemoryStore {
  /** The bot behind the conversation, when memory may change in this turn. */
  const writable = async (conversationId: number) => {
    const owner = await conversationOwner(conversationId);
    if (!owner?.bot.memoryEnabled) return "disabled" as const;
    // A runtime that can't be read counts as unattended (refuses, never allows).
    const reader: ChatReader = { readChat: (ref) => runtime().readChat(ref) };
    if (await isUnattended(conversationId, reader, owner)) return "unattended" as const;
    return owner.bot;
  };

  return {
    async remember(conversationId, input) {
      const bot = await writable(conversationId);
      if (typeof bot === "string") return { status: bot };
      const item = extractedMemorySchema.parse({ ...input, confidence: 1 });
      const result = await applyExtraction(bot.id, [item]);
      return { status: result.created > 0 ? "saved" : "duplicate" };
    },

    async forget(conversationId, input) {
      const bot = await writable(conversationId);
      if (typeof bot === "string") return { status: bot, removed: [] };
      const wanted = [...new Set(wordsOf(input.text))].filter((w) => !GENERIC_WORDS.has(w));
      if (wanted.length === 0) return { status: "vague", removed: [] };
      const active = await db
        .select({ id: memories.id, text: memories.text })
        .from(memories)
        .where(and(eq(memories.botId, bot.id), eq(memories.status, "active")))
        .orderBy(asc(memories.createdAt));
      const matches = active.filter((m) => {
        const own = new Set(wordsOf(m.text));
        return wanted.every((w) => own.has(w));
      });
      if (matches.length === 0) return { status: "none", removed: [] };
      // A tombstone, as the Memory page's delete: never re-added by capture.
      await db
        .update(memories)
        .set({ status: "deleted" })
        .where(
          and(
            inArray(
              memories.id,
              matches.map((m) => m.id),
            ),
            eq(memories.status, "active"),
          ),
        );
      return { status: "forgotten", removed: matches.map((m) => m.text) };
    },

    async list(conversationId: number) {
      // A routine's turns read its bot's memories too; only writes are refused.
      const owner = await conversationOwner(conversationId);
      if (!owner?.bot.memoryEnabled) return [];
      const rows = await db.query.memories.findMany({
        where: eq(memories.botId, owner.bot.id),
        orderBy: (m, { asc }) => [asc(m.createdAt)],
      });
      const now = new Date();
      return rows
        .filter(
          (m) =>
            m.status === "active" && !isExpired({ until: m.until?.toISOString() ?? null }, now),
        )
        .map((m) => ({
          text: m.text,
          category: m.category,
          until: m.until?.toISOString() ?? null,
          createdAt: m.createdAt.toISOString(),
        }))
        .sort((a, b) => order(a.category) - order(b.category));
    },
  };
}

export const memoryStore = createMemoryStore();

export type { MemoryLine };
