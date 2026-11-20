/**
 * Bot builder (issue #149): a bot can create a new bot through `create_bot`
 * when the owner asks it to ("make a bot for my Limitless project"). The
 * tool is `askOnly`, like `update_instructions`: the owner approves every
 * new bot in chat, with its name, description, model and full instructions
 * on the approval card, and the app's store adapter refuses unattended turns
 * (routine runs, peer deliveries) and chats shared with guests (managing
 * bots is the owner's), so nobody but the owner can spawn bots.
 *
 * Replay is `unsafe`: a create interrupted by a restart is not re-run on
 * recovery (it would either duplicate the bot or fail on its now-taken
 * name); the model sees the interruption and can check the roster.
 */
import { Type } from "@earendil-works/pi-ai";
import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";
import { defineToolkit, tool } from "../toolkit";

/** Why a new bot was not created, as the model reads it. */
export type BotCreationRefusal =
  | "disabled"
  | "unattended"
  | "shared"
  | "name_taken"
  | "unknown_model"
  | "invalid";

/** What `create_bot` asks the app for. */
export interface NewBotInput {
  name: string;
  description?: string;
  /** The new bot's system prompt. */
  instructions: string;
  /** A model id; the creating bot's model when omitted. */
  model?: string;
}

/** What the app provides: create a bot on behalf of the bot behind a conversation. */
export interface BotCreationStore {
  create(
    conversationId: number,
    input: NewBotInput,
  ): Promise<
    | {
        status: "created";
        bot: { id: string; name: string; modelId: string; url: string };
      }
    | {
        status: BotCreationRefusal;
        /** `unknown_model`: the model ids that are available. */
        models?: string[];
        /** `invalid`: what is wrong with the input, as the New bot dialog says it. */
        reason?: string;
      }
  >;
}

const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

function refusal(
  status: BotCreationRefusal,
  input: NewBotInput,
  details: { models?: string[]; reason?: string },
): ToolExecutionResult {
  const models = details.models ?? [];
  switch (status) {
    case "disabled":
      return fail("Creating bots is not available here. Nothing was created.");
    case "unattended":
      return fail(
        "Bots can only be created in the owner's own turns, not in a routine run or another bot's message. Nothing was created.",
      );
    case "shared":
      return fail(
        "Bots can't be created from a chat shared with guests. Ask the owner to create it from one of their own bots' chats. Nothing was created.",
      );
    case "name_taken":
      return fail(
        `A bot named "${input.name}" already exists. Nothing was created. Ask the owner for another name, or message that bot instead.`,
      );
    case "unknown_model":
      return fail(
        `Unknown model "${input.model ?? ""}". Nothing was created.` +
          (models.length > 0 ? ` Available models: ${models.join(", ")}.` : ""),
      );
    case "invalid":
      return fail(
        `Invalid bot: ${details.reason ?? "check the name and instructions"}. Nothing was created.`,
      );
  }
}

export function createBotBuilderCapability(store: BotCreationStore): Capability {
  const createBot = tool({
    name: "create_bot",
    label: "Created bot",
    askLabel: "create a new bot",
    summary: "Create a new bot",
    policy: { askOnly: true },
    description:
      "Create a new bot, only when the owner asks for one. Write its instructions in the second person " +
      '("You help the owner with …") with everything the owner told you about its job, paths, tools and rules. ' +
      "It gets every built-in toolkit and your model unless `model` names another. " +
      "The owner approves it first; then you can message it with message_bot.",
    parameters: Type.Object({
      name: Type.String({
        minLength: 1,
        maxLength: 100,
        description: "The new bot's name (unique among bots)",
      }),
      description: Type.Optional(
        Type.String({ maxLength: 200, description: "One line: what the bot is for" }),
      ),
      instructions: Type.String({
        minLength: 1,
        maxLength: 24_576,
        description: "The new bot's complete system prompt",
      }),
      model: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 200,
          description: "Model id for the new bot; defaults to yours",
        }),
      ),
    }),
    replay: "unsafe",
    execute: async (args, api) => {
      const input: NewBotInput = {
        name: args.name.trim(),
        instructions: args.instructions,
        ...(args.description?.trim() ? { description: args.description.trim() } : {}),
        ...(args.model?.trim() ? { model: args.model.trim() } : {}),
      };
      const result = await store.create(Number(api.conversationId), input);
      if (result.status !== "created") return refusal(result.status, input, result);
      const { bot } = result;
      return {
        output: [
          {
            type: "text" as const,
            text:
              `Created bot "${bot.name}" on ${bot.modelId}. The owner can open it at ${bot.url}. ` +
              `You can message it with message_bot(to: "${bot.name}", text).`,
          },
        ],
        details: { botId: bot.id, name: bot.name, modelId: bot.modelId, url: bot.url },
      };
    },
  });

  return defineToolkit({
    id: "bot-builder",
    // Used in few conversations: loaded with tool_search (issue #360).
    deferred: true,
    name: "Bot builder",
    description: "Create new bots, with owner approval",
    tools: [createBot],
  });
}
