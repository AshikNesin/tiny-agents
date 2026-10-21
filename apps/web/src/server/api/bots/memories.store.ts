/**
 * MemoryStore adapter: the agent's `memory` capability reads the bot's
 * injectable memories from app.db. Dependency direction stays one-way —
 * `@tiny-agents/agent` defines the port, apps/web implements it.
 *
 * Ordering matches memories.domain.ts exactly (fixed category order, then
 * createdAt ascending) so the rendered block is deterministic for the
 * provider's prompt cache.
 */
import { prisma } from "@groot/core/database";
import {
  CATEGORY_ORDER,
  extractedMemorySchema,
  isExpired,
  type MemoryCategory,
} from "./memories.domain";
import { applyExtraction } from "./memories.capture";
import type { MemoryLine, MemoryStore } from "@tiny-agents/agent";

function order(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category as MemoryCategory);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

export const memoryStore: MemoryStore = {
  async remember(conversationId, input) {
    const bot = await prisma.bot.findUnique({
      where: { conversationId: String(conversationId) },
      select: { id: true, memoryEnabled: true },
    });
    if (!bot?.memoryEnabled) return { status: "disabled" };
    const item = extractedMemorySchema.parse({ ...input, confidence: 1 });
    const result = await applyExtraction(bot.id, [item]);
    return { status: result.created > 0 ? "saved" : "duplicate" };
  },

  async list(conversationId: number) {
    const bot = await prisma.bot.findUnique({
      where: { conversationId: String(conversationId) },
      select: {
        memoryEnabled: true,
        memories: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!bot || !bot.memoryEnabled) return [];
    const now = new Date();
    return bot.memories
      .filter(
        (m) => m.status === "active" && !isExpired({ until: m.until?.toISOString() ?? null }, now),
      )
      .map((m) => ({
        text: m.text,
        category: m.category,
        until: m.until?.toISOString() ?? null,
      }))
      .sort((a, b) => order(a.category) - order(b.category));
  },
};

export type { MemoryLine };
