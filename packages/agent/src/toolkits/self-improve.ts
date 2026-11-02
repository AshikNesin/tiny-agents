/**
 * Self-improvement: a bot can propose edits to its own
 * system prompt through `update_instructions`. The tool is `askOnly` — the owner
 * approves every change in chat before it lands — and the app's store adapter
 * refuses unattended turns (routine runs, peer deliveries), so a planted
 * prompt can never reach a later request without the owner watching.
 *
 * History: the app records every applied change as a full-snapshot revision
 * row, the database analog of committing a plain instructions file to git.
 * Reverting is restoring a revision's text through another approved change.
 *
 * Connections: when the owner has connections the bot is not linked to, they
 * are listed in a prompt section and `enable_connection` (also `askOnly`)
 * links one after the owner approves in chat. The app re-applies the bot's
 * config before the tool returns, so the new tools are usable in the same
 * reply.
 */
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import type { Capability, ToolInfo } from "../capabilities";

/** Why an instructions change was refused, as the model reads it. */
export type InstructionsRefusal = "disabled" | "unattended";

/** What the app provides: read, apply and review the bot's instructions. */
export interface InstructionsStore {
  /** The bot's current system prompt behind the conversation. */
  read(conversationId: number): Promise<string>;
  /** Apply a change; `prompt` is the new text on success. */
  update(
    conversationId: number,
    input: { instructions?: string; append?: string },
  ): Promise<{ status: "updated" | InstructionsRefusal; prompt?: string }>;
}

/** One of the owner's connections the bot could be given. */
export interface ConnectionOffer {
  /** The connection's slug: what `enable_connection` takes. */
  slug: string;
  name: string;
  /** A few of its tool names, so the model can tell what it is for. */
  tools: string[];
}

/** What the app provides: the owner's unlinked connections, and the link itself. */
export interface ConnectionLinks {
  /** Connections the bot behind the conversation does not have yet. */
  available(conversationId: number): Promise<ConnectionOffer[]>;
  /** Link one to the bot (already linked counts as enabled) and apply it to the conversation. */
  enable(
    conversationId: number,
    slug: string,
  ): Promise<{ status: "enabled" | "unknown" | InstructionsRefusal; name?: string }>;
}

const REFUSED = {
  disabled: "Self-editing is not available for this bot. Nothing was changed.",
  unattended:
    "Instructions can only change in the owner's own turns, not in a routine run or another bot's message. Nothing was changed.",
} as const;

const UPDATE_INFO = {
  name: "update_instructions",
  label: "Updated own instructions",
  askLabel: "update own instructions",
  description: "Edit this bot's system prompt",
  askOnly: true,
} satisfies ToolInfo;

const ENABLE_INFO = {
  name: "enable_connection",
  label: "Enabled a connection",
  askLabel: "enable a connection",
  description: "Link one of the owner's connections to this bot",
  askOnly: true,
} satisfies ToolInfo;

const CONNECTION_REFUSED = {
  ...REFUSED,
  disabled: "Connections can't be enabled for this bot. Nothing was changed.",
  unknown: "The owner has no connection by that name. Nothing was changed.",
} as const;

export function createSelfImproveCapability(
  store: InstructionsStore,
  links?: ConnectionLinks,
): Capability {
  const update = defineTool({
    name: "update_instructions",
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
    replay: "safe",
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

  const connections = links ? connectionParts(links) : undefined;
  return {
    id: "self-improve",
    kind: "toolkit",
    name: "Self-improve",
    description: connections
      ? "Update this bot's own instructions and connections, with owner approval"
      : "Update this bot's own instructions, with owner approval",
    extension: defineExtension({
      name: "self-improve",
      tools: connections ? [update, connections.tool] : [update],
      sections: connections ? [current, connections.section] : [current],
    }),
    tools: connections ? [UPDATE_INFO, ENABLE_INFO] : [UPDATE_INFO],
  };
}

/** `enable_connection` and the section listing what it can enable. */
function connectionParts(links: ConnectionLinks) {
  const tool = defineTool({
    name: "enable_connection",
    description:
      "Ask the owner to enable one of their connections (listed under 'Connections you could use') for you. " +
      "Use it when a connection would clearly help with what the owner asked; say in a sentence why first. " +
      "The owner approves in chat; once enabled, its tools are available right away.",
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 64, description: "The connection's slug" }),
    }),
    replay: "safe",
    execute: async (args, api) => {
      const result = await links.enable(Number(api.conversationId), args.name);
      if (result.status !== "enabled") {
        return {
          output: [{ type: "text" as const, text: CONNECTION_REFUSED[result.status] }],
          isError: true,
        };
      }
      return {
        output: [
          {
            type: "text" as const,
            text: `Enabled ${result.name ?? args.name}. Its tools are available now.`,
          },
        ],
      };
    },
  });

  const offers = section("self-connections", async (input) => {
    const available = await links.available(Number(input.conversationId));
    if (available.length === 0) return undefined;
    const lines = available.map((offer) => {
      const tools = offer.tools.length > 0 ? `: ${offer.tools.join(", ")}` : "";
      return `- ${offer.slug} (${offer.name})${tools}`;
    });
    return (
      "## Connections you could use\n" +
      "The owner has these connections, but they are not enabled for you. If one would " +
      "help with the request, call enable_connection; the owner approves it in chat.\n\n" +
      lines.join("\n")
    );
  });

  return { tool, section: offers };
}
