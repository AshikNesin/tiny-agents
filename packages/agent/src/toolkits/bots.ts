import { section, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import type { Capability } from "../capabilities";
import { defineToolkit, tool } from "../toolkit";
import { toolIdempotencyKey } from "./tasks";
import { CUSTODY_RULE, sanitizePeerText } from "./peer-text";

export interface BotMessagingStore {
  deliver(input: {
    conversationId: number;
    toName: string;
    text: string;
    requestId: string;
    sourceKey: string;
  }): Promise<{
    delivered: boolean;
    reason?: "unknown_bot" | "self" | "loop" | "budget";
    queued?: boolean;
  }>;
  roster(conversationId: number): Promise<{ name: string; description: string }[]>;
}

const ok = (text: string): ToolExecutionResult => ({ output: [{ type: "text", text }] });
const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

const noDeliver = (to: string, reason: string): ToolExecutionResult =>
  fail(
    `Message to "${to}" was not delivered (${reason}). ` +
      (reason === "budget"
        ? "You have already messaged several bots this turn: finish your turn and let the replies arrive."
        : reason === "loop"
          ? "You have messaged this bot many times in a short window: wait before trying again."
          : "Do not repeat the call unchanged."),
  );

export function createBotsToolkit(store: BotMessagingStore): Capability {
  const messageBot = tool({
    name: "message_bot",
    label: "Messaged bot",
    askLabel: "message another bot",
    summary: "Send a message to another bot",
    description:
      "Send a message to another bot by name, to ask for help or information or to collaborate. " +
      'Fire-and-forget: the reply arrives later in your conversation as "Reply from <name>", ' +
      "so there is no need to wait or poll. Never repeat or re-send a reply that already arrived from that bot " +
      "(the owner already sees it), and never acknowledge a relayed reply by messaging the sender back. " +
      "Keep the text self-contained, with all context the other bot needs.",
    parameters: Type.Object({
      to: Type.String({ minLength: 1, maxLength: 100, description: "Bot name from the roster" }),
      text: Type.String({ minLength: 1, maxLength: 8000, description: "Your message" }),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const sourceKey = await toolIdempotencyKey(api, context);
      const { delivered, reason, queued } = await store.deliver({
        conversationId: Number(api.conversationId),
        toName: args.to,
        text: sanitizePeerText(args.text),
        requestId: `botmsg-${sourceKey}`,
        sourceKey,
      });
      if (!delivered) return noDeliver(args.to, reason ?? "unknown_bot");
      const state = queued
        ? "queued behind their current reply; it will run when they settle"
        : "delivered";
      return ok(
        `Message ${state} for ${args.to}. ` +
          `The reply arrives here as "Reply from ${args.to}" - do not message them back just to acknowledge it.`,
      );
    },
  });

  const roster = section("bots", async (input) => {
    const bots = await store.roster(Number(input.conversationId));
    if (bots.length === 0) return undefined;
    const lines = bots.map((bot) => `- ${bot.name}: ${bot.description}`);
    return ["You can message these bots with message_bot(to, text).", ...lines, CUSTODY_RULE].join(
      "\n",
    );
  });

  return defineToolkit({
    id: "bots",
    name: "Bots",
    description: "Message other bots",
    tools: [messageBot],
    sections: [roster],
  });
}
