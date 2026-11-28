import { CATEGORY_ORDER, extractedMemorySchema, type MemoryCategory } from "./memories.domain";
import { memoryLedger } from "./memories.ledger";
import { getAgentRuntime } from "../bots/bots.runtime";
import { conversationOwner, ownerTurnOf, type ChatReader } from "../bots/bots.owner";
import type { MemoryStore } from "@tiny-agents/agent";

function order(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category as MemoryCategory);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

const GENERIC_WORDS: ReadonlySet<string> = new Set(
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
  const writable = async (conversationId: number) => {
    const turn = await ownerTurnOf(conversationId, runtime);
    if (turn.status === "disabled" || !turn.owner.bot.memoryEnabled) return "disabled" as const;
    if (turn.status === "unattended") return "unattended" as const;
    return turn.owner.bot;
  };

  return {
    async remember(conversationId, input) {
      const bot = await writable(conversationId);
      if (typeof bot === "string") return { status: bot };
      const item = extractedMemorySchema.parse(input);
      const result = await memoryLedger(bot.id).add([item], {
        source: "capture",
        conversationId: String(conversationId),
      });
      return { status: result.created > 0 ? "saved" : "duplicate" };
    },

    async forget(conversationId, input) {
      const bot = await writable(conversationId);
      if (typeof bot === "string") return { status: bot, removed: [] };
      const wanted = [...new Set(wordsOf(input.text))].filter((w) => !GENERIC_WORDS.has(w));
      if (wanted.length === 0) return { status: "vague", removed: [] };
      const ledger = memoryLedger(bot.id);
      const matches = (await ledger.active()).filter((m) => {
        const own = new Set(wordsOf(m.text));
        return wanted.every((w) => own.has(w));
      });
      if (matches.length === 0) return { status: "none", removed: [] };
      await ledger.tombstone(matches.map((m) => m.id));
      return { status: "forgotten", removed: matches.map((m) => m.text) };
    },

    async list(conversationId: number) {
      const owner = await conversationOwner(conversationId);
      if (!owner?.bot.memoryEnabled) return [];
      return (await memoryLedger(owner.bot.id).active())
        .map((m) => ({
          text: m.text,
          category: m.category,
          until: m.until?.toISOString() ?? null,
          createdAt: m.createdAt.toISOString(),
          learnedHere: m.conversationId === String(conversationId),
        }))
        .sort((a, b) => order(a.category) - order(b.category));
    },
  };
}

export const memoryStore = createMemoryStore();
