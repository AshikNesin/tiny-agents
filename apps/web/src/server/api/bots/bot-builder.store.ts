import { botModelId } from "./bot-toolkits";
import { HttpError } from "@groot/core/errors";
import type { BotCreationStore } from "@tiny-agents/agent";
import { ownerTurnOf } from "./bots.owner";
import { getAgentRuntime } from "./bots.runtime";
import { createBotSchema } from "./bots.schema";
import { createBot, type BotAgentRuntime } from "./bots.service";

export function createBotCreationStore(
  runtime: () => BotAgentRuntime = () => getAgentRuntime(),
): BotCreationStore {
  return {
    async create(conversationId, input) {
      const turn = await ownerTurnOf(conversationId, runtime);
      if (turn.status !== "owner") return { status: turn.status };
      const { owner } = turn;

      const parsed = createBotSchema.safeParse({
        name: input.name,
        description: input.description,
        systemPrompt: input.instructions,
        modelId: input.model ?? botModelId(runtime().catalog, owner.bot.modelId),
      });
      if (!parsed.success) {
        return { status: "invalid", reason: parsed.error.issues.map((i) => i.message).join("; ") };
      }
      const rt = runtime();
      if (!rt.catalog.get(parsed.data.modelId)) {
        return {
          status: "unknown_model",
          models: rt.catalog
            .list({ type: "chat", enabledOnly: true })
            .map((model) => `${model.id} (${model.providerName} / ${model.name})`),
        };
      }
      try {
        const bot = await createBot(parsed.data, rt);
        return {
          status: "created",
          bot: { id: bot.id, name: bot.name, modelId: bot.modelId ?? "", url: `/chats/${bot.id}` },
        };
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 409) return { status: "name_taken" };
        throw error;
      }
    },
  };
}
