import { Type } from "typebox";
import { section } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";
import { defineToolkit, tool } from "../toolkit";

type InstructionsRefusal = "disabled" | "unattended" | "shared";

export interface InstructionsStore {
  read(conversationId: number): Promise<string>;
  update(
    conversationId: number,
    input: { instructions?: string; append?: string },
  ): Promise<{ status: "updated" | InstructionsRefusal; prompt?: string }>;
}

const REFUSED = {
  disabled: "Self-editing is not available for this bot. Nothing was changed.",
  unattended:
    "Instructions can only change in the owner's own turns, not in a routine run or another bot's message. Nothing was changed.",
  shared:
    "Instructions can't change from a chat shared with guests. Ask the owner to edit the bot in its settings. Nothing was changed.",
} as const;

export function createSelfImproveCapability(store: InstructionsStore): Capability {
  const update = tool({
    name: "update_instructions",
    label: "Updated own instructions",
    askLabel: "update own instructions",
    summary: "Edit this bot's system prompt",
    policy: { askOnly: true },
    description:
      "Update your own instructions (system prompt). Pass exactly one of `instructions` (the complete new text, replacing the current one) or `append` (lines added to the end). " +
      "Use when the owner asks you to change how you work, or when you both agreed on an improvement. " +
      "The owner reviews and approves every change before it applies.",
    parameters: Type.Object({
      instructions: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 24_576,
          description: "The complete new system prompt (replaces the current text)",
        }),
      ),
      append: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 2_000,
          description: "Lines to append to the end of the current system prompt",
        }),
      ),
    }),
    replay: "unsafe",
    execute: async (args, api) => {
      const result = await store.update(Number(api.conversationId), args);
      if (result.status !== "updated") {
        return {
          output: [{ type: "text" as const, text: REFUSED[result.status] }],
          isError: true,
        };
      }
      return {
        output: [
          {
            type: "text" as const,
            text:
              "Instructions updated. They apply from your next message; this reply still runs on the old ones.\n\n" +
              `New instructions:\n${result.prompt ?? ""}`,
          },
        ],
        ...(result.prompt !== undefined ? { details: { prompt: result.prompt } } : {}),
      };
    },
  });

  const current = section("self-instructions", async (input) => {
    const prompt = await store.read(Number(input.conversationId));
    if (!prompt) return undefined;
    return (
      "## Your current instructions\n" +
      "You can update these with update_instructions; the owner approves every change.\n\n" +
      prompt
    );
  });

  return defineToolkit({
    id: "self-improve",
    deferred: true,
    name: "Self-improve",
    description: "Update this bot's own instructions, with owner approval",
    tools: [update],
    sections: [current],
  });
}
