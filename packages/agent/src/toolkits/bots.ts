/**
 * The `bots` toolkit (issue #12): bot-to-bot messaging over the app's
 * `BotMessage` ledger. The app injects a `BotMessagingStore` when it opens
 * the runtime; `message_bot` runs inside pi-durable with `replay: "safe"`,
 * so a call interrupted by a restart re-executes on recovery. Exactly-once
 * is the store's job: the tool derives its `sourceKey` and `requestId`
 * deterministically from the durable tool task (same key as `tasks`), so a
 * replay recomputes both and the store's unique columns dedupe the row.
 */
import { section, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import type { Capability } from "../capabilities";
import { defineToolkit, tool } from "../toolkit";
import { toolIdempotencyKey } from "./tasks";
import { CUSTODY_RULE, sanitizePeerText } from "./peer-text";

/** What the app provides: delivery and the roster over its own database. */
export interface BotMessagingStore {
  /** Deliver a message into to's conversation. Idempotent on requestId. */
  deliver(input: {
    conversationId: number;
    toName: string;
    text: string;
    requestId: string;
    sourceKey: string;
  }): Promise<{
    delivered: boolean;
    reason?: "unknown_bot" | "self" | "loop" | "budget";
    /** True when the target is mid-reply; the message runs after it settles. */
    queued?: boolean;
  }>;
  /**
   * Bot names the model can message (roster section). Only stable fields: a
   * section whose text changes is sent to the model again, so a live "busy"
   * flag would append a fresh roster to the transcript every time a bot
   * starts or stops a reply. `message_bot` says when a message is queued.
   */
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

/** The `bots` toolkit: message other bots (`apps/web` bots.runtime.ts). */
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
