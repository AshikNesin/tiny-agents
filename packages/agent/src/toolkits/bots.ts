/**
 * The `bots` toolkit (issue #12): bot-to-bot messaging over the app's
 * `BotMessage` ledger. The app injects a `BotMessagingStore` when it opens
 * the runtime; `message_bot` runs inside pi-durable with `replay: "safe"`,
 * so a call interrupted by a restart re-executes on recovery. Exactly-once
 * is the store's job: the tool derives its `sourceKey` and `requestId`
 * deterministically from the durable tool task (same key as `tasks`), so a
 * replay recomputes both and the store's unique columns dedupe the row.
 */
import type { Context } from "@earendil-works/chord";
import {
  defineExtension,
  defineTool,
  ProviderDoc,
  section,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";
import { toolIdempotencyKey } from "./tasks";

/** What the app provides: delivery and the roster over its own database. */
export interface BotMessagingStore {
  /** Deliver a message into to's conversation. Idempotent on requestId. */
  deliver(input: {
    conversationId: number;
    toName: string;
    text: string;
    requestId: string;
    sourceKey: string;
  }): Promise<{ delivered: boolean; reason?: "unknown_bot" | "self" | "loop" | "busy_target" }>;
  /** Bot names the model can message (roster section). */
  roster(conversationId: number): Promise<{ name: string; description: string }[]>;
}

const ok = (text: string): ToolExecutionResult => ({ output: [{ type: "text", text }] });
const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

const noDeliver = (to: string, reason: string): ToolExecutionResult =>
  fail(`Message to "${to}" was not delivered (${reason}).`);

/** The `bots` toolkit: message other bots (`apps/web` bots.runtime.ts). */
export function createBotsToolkit(store: BotMessagingStore): Capability {
  const messageBot = defineTool({
    name: "message_bot",
    description:
      "Send a message to another bot by name, to ask for help or information or to collaborate. " +
      "Fire-and-forget: the reply arrives later in your conversation as \"Reply from <name>\", " +
      "so there is no need to wait or poll. Keep the text self-contained, with all context the other bot needs.",
    parameters: Type.Object({
      to: Type.String({ minLength: 1, maxLength: 100, description: "Bot name from the roster" }),
      text: Type.String({ minLength: 1, maxLength: 8000, description: "Your message" }),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const sourceKey = await toolIdempotencyKey(api, context);
      const { delivered, reason } = await store.deliver({
        conversationId: Number(api.conversationId),
        toName: args.to,
        text: args.text,
        requestId: `botmsg-${sourceKey}`,
        sourceKey,
      });
      if (!delivered) return noDeliver(args.to, reason ?? "unknown_bot");
      return ok(`Message sent to ${args.to}. The reply arrives here as "Reply from ${args.to}".`);
    },
  });

  const roster = section("bots", async (input) => {
    const bots = await store.roster(Number(input.conversationId));
    if (bots.length === 0) return undefined;
    const lines = bots.map((bot) => `- ${bot.name}: ${bot.description}`);
    return `You can message these bots with message_bot(to, text).\n${lines.join("\n")}`;
  });

  return {
    id: "bots",
    kind: "toolkit",
    name: "Bots",
    description: "Message other bots",
    extension: defineExtension({ name: "bots", tools: [messageBot], sections: [roster] }),
    tools: [
      {
        name: "message_bot",
        label: "Messaged bot",
        description: "Send a message to another bot",
      },
    ],
  };
}
