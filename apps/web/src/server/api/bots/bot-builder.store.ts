/**
 * BotCreationStore adapter (issue #149): the agent's `bot-builder`
 * capability creates bots through here, with the same `createBot` the
 * owner's "New bot" dialog uses, so names stay unique and the new bot's
 * conversation is set up the same way. Dependency direction stays one-way —
 * `@tiny-agents/agent` defines the port, apps/web implements it.
 *
 * Creates happen only in the owner's own turns in a chat that is not shared
 * with guests: a routine run, another bot's message or a guest's approval
 * is refused even after the card was approved (`create_bot` is `askOnly`,
 * so there is no "always allow" in the first place).
 */
import { HttpError } from "@groot/core/errors";
import type { BotCreationStore } from "@tiny-agents/agent";
import { conversationOwner, isUnattended, type ChatReader } from "./bots.owner";
import { getAgentRuntime } from "./bots.runtime";
import { createBotSchema } from "./bots.schema";
import { createBot, type BotAgentRuntime } from "./bots.service";

export function createBotCreationStore(
  runtime: () => BotAgentRuntime = () => getAgentRuntime(),
): BotCreationStore {
  return {
    async create(conversationId, input) {
      const owner = await conversationOwner(conversationId);
      if (!owner) return { status: "disabled" };
      // A runtime that can't be read counts as unattended (refuses, never allows).
      const reader: ChatReader = { readChat: (ref) => runtime().readChat(ref) };
      if (await isUnattended(conversationId, reader, owner)) return { status: "unattended" };
      if (owner.bot.shared) return { status: "shared" };

      // The New bot dialog's own validation, so the tool and the dialog can't drift.
      const parsed = createBotSchema.safeParse({
        name: input.name,
        description: input.description,
        systemPrompt: input.instructions,
        modelId: input.model ?? owner.bot.modelId,
      });
      if (!parsed.success) {
        return { status: "invalid", reason: parsed.error.issues.map((i) => i.message).join("; ") };
      }
      const rt = runtime();
      if (!rt.catalog.has(parsed.data.modelId)) {
        return { status: "unknown_model", models: rt.catalog.list().map((model) => model.id) };
      }
      try {
        const bot = await createBot(parsed.data, rt);
        return {
          status: "created",
          bot: { id: bot.id, name: bot.name, modelId: bot.modelId, url: `/chats/${bot.id}` },
        };
      } catch (error) {
        // createBot's 409: another bot already has the name.
        if (error instanceof HttpError && error.statusCode === 409) return { status: "name_taken" };
        throw error;
      }
    },
  };
}
