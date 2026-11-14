/**
 * InstructionsStore adapter: the agent's `self-improve` capability reads and
 * rewrites the bot's `system_prompt` row through here. Dependency direction
 * stays one-way — `@tiny-agents/agent` defines the port, apps/web implements
 * it.
 *
 * Writes happen only in the owner's own turns (the same rule as `remember`):
 * a routine run, another bot's message or a chat shared with guests is
 * refused even when the owner set the tool to Always allow, and the `askOnly` flag means there is no "always
 * allow" in the first place — every change waits for the owner in chat.
 *
 * Every applied change appends a full-snapshot `prompt_revisions` row before
 * the bot row is updated, so history survives further edits (and deleting a
 * revision never corrupts the current prompt).
 */
import { and, eq } from "drizzle-orm";
import { db, bots, promptRevisions } from "../../db";
import { chatOwner, conversationOwner, isUnattended, type ChatReader } from "./bots.owner";
import { getAgentRuntime } from "./bots.runtime";
import type { InstructionsStore } from "@tiny-agents/agent";

export function createInstructionsStore(
  runtime: () => ChatReader = () => getAgentRuntime(),
): InstructionsStore {
  return {
    async read(conversationId) {
      // The chat's bot only: a routine's conversation reads "" (pinned as is).
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
      const owner = await conversationOwner(conversationId);
      if (!owner) return refuse("disabled");
      // A runtime that can't be read counts as unattended (refuses, never allows).
      const reader: ChatReader = { readChat: (ref) => runtime().readChat(ref) };
      if (await isUnattended(conversationId, reader, owner)) return refuse("unattended");
      // A guest's turn reads as attended, and a guest can answer the card,
      // so a shared chat never changes the prompt (as bot-builder; S1).
      if (owner.bot.shared) return refuse("shared");

      // The bot the owner lookup found, while this is still its chat.
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

      // Revision first: history records what was applied, even if the row
      // update below never runs (a crash between the two leaves an extra
      // revision, never a missing one).
      await db.insert(promptRevisions).values({ botId: bot.id, prompt, source: "self" });
      await db
        .update(bots)
        .set({ systemPrompt: prompt, updatedAt: new Date() })
        .where(eq(bots.id, bot.id));
      return { status: "updated", prompt };
    },
  };
}
