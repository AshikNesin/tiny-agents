import { and, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { db, bots, promptRevisions } from "../../db";
import { chatOwner, ownerTurnOf, type ChatReader } from "./bots.owner";
import { getAgentRuntime } from "./bots.runtime";
import type { InstructionsStore } from "@tiny-agents/agent";

const PROMPT_UPDATE_ATTEMPTS = 5;

class PromptMovedError extends Error {}

export function createInstructionsStore(
  runtime: () => ChatReader = () => getAgentRuntime(),
): InstructionsStore {
  return {
    async read(conversationId) {
      const owner = await chatOwner(conversationId);
      if (!owner) return "";
      const bot = await db.query.bots.findFirst({
        where: and(eq(bots.id, owner.id), eq(bots.conversationId, String(conversationId))),
        columns: { systemPrompt: true },
      });
      return bot?.systemPrompt ?? "";
    },

    async update(conversationId, input) {
      const refuse = (status: "disabled" | "unattended" | "shared") => ({ status });
      const turn = await ownerTurnOf(conversationId, runtime);
      if (turn.status !== "owner") return refuse(turn.status);
      const { owner } = turn;

      for (let attempt = 1; ; attempt++) {
        const bot = await db.query.bots.findFirst({
          where: and(eq(bots.id, owner.bot.id), eq(bots.conversationId, String(conversationId))),
          columns: { id: true, systemPrompt: true },
        });
        if (!bot) return refuse("disabled");

        const prompt =
          input.instructions !== undefined
            ? input.instructions
            : input.append !== undefined
              ? [bot.systemPrompt, input.append].filter(Boolean).join("\n\n")
              : bot.systemPrompt;
        if (prompt === bot.systemPrompt) {
          return { status: "updated", prompt };
        }

        try {
          db.transaction((tx) => {
            tx.insert(promptRevisions).values({ botId: bot.id, prompt, source: "self" }).run();
            const { changes } = tx
              .update(bots)
              .set({ systemPrompt: prompt, updatedAt: new Date() })
              .where(and(eq(bots.id, bot.id), eq(bots.systemPrompt, bot.systemPrompt)))
              .run();
            if (changes === 0) throw new PromptMovedError();
          });
          return { status: "updated", prompt };
        } catch (error) {
          if (!(error instanceof PromptMovedError)) throw error;
          if (attempt >= PROMPT_UPDATE_ATTEMPTS) {
            throw Boom.conflict("The system prompt changed while updating it; try again");
          }
        }
      }
    },
  };
}
