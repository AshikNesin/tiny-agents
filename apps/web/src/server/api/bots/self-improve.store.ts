/**
 * InstructionsStore adapter: the agent's `self-improve` capability reads and
 * rewrites the bot's `system_prompt` row through here. Dependency direction
 * stays one-way — `@tiny-agents/agent` defines the port, apps/web implements
 * it.
 *
 * Writes happen only in the owner's own turns (the same rule as `remember`):
 * a routine run or another bot's message is refused even when the owner set
 * the tool to Always allow, and the `askOnly` flag means there is no "always
 * allow" in the first place — every change waits for the owner in chat.
 *
 * Every applied change appends a full-snapshot `prompt_revisions` row before
 * the bot row is updated, so history survives further edits (and deleting a
 * revision never corrupts the current prompt).
 *
 * ConnectionLinks adapter: the same capability offers the owner's connections
 * the bot is not linked to and links one after the owner approves, under the
 * same owner's-turn rule. Linking reconciles the conversation before the tool
 * returns, so the new tools are there for the rest of the reply.
 */
import { eq, notInArray } from "drizzle-orm";
import { db, botConnections, bots, connections, promptRevisions } from "../../db";
import { conversationOwner, isUnattended, type ChatReader } from "./bots.owner";
import { reconcileBotConversation, type BotConversationRuntime } from "./bots.conversation";
import { getAgentRuntime } from "./bots.runtime";
import type { ConnectionLinks, InstructionsStore } from "@tiny-agents/agent";

export function createInstructionsStore(
  runtime: () => ChatReader = () => getAgentRuntime(),
): InstructionsStore {
  return {
    async read(conversationId) {
      const bot = await db.query.bots.findFirst({
        where: eq(bots.conversationId, String(conversationId)),
        columns: { systemPrompt: true },
      });
      return bot?.systemPrompt ?? "";
    },

    async update(conversationId, input) {
      const refuse = (status: "disabled" | "unattended") => ({ status });
      const owner = await conversationOwner(conversationId);
      if (!owner) return refuse("disabled");
      // A runtime that can't be read counts as unattended (refuses, never allows).
      const reader: ChatReader = { readChat: (ref) => runtime().readChat(ref) };
      if (await isUnattended(conversationId, reader, owner)) return refuse("unattended");

      const bot = await db.query.bots.findFirst({
        where: eq(bots.conversationId, String(conversationId)),
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

/** How many tool names each offered connection shows the model. */
const OFFER_TOOLS = 5;

function parseNames(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: unknown) =>
      typeof item === "string"
        ? [item]
        : typeof (item as { name?: unknown })?.name === "string"
          ? [(item as { name: string }).name]
          : [],
    );
  } catch {
    return [];
  }
}

export function createConnectionLinks(
  runtime: () => ChatReader & Pick<BotConversationRuntime, "configure" | "listModels"> = () =>
    getAgentRuntime(),
): ConnectionLinks {
  return {
    async available(conversationId) {
      // Only the bot's chat: a routine run could never get the approval.
      const owner = await conversationOwner(conversationId);
      if (owner?.kind !== "chat") return [];
      const linked = db
        .select({ id: botConnections.connectionId })
        .from(botConnections)
        .where(eq(botConnections.botId, owner.bot.id));
      const rows = await db
        .select({
          slug: connections.slug,
          name: connections.name,
          toolsCache: connections.toolsCache,
          disabledTools: connections.disabledTools,
        })
        .from(connections)
        .where(notInArray(connections.id, linked))
        .orderBy(connections.name);
      return rows.flatMap((row) => {
        const off = new Set(parseNames(row.disabledTools));
        const tools = parseNames(row.toolsCache).filter((name) => !off.has(name));
        // No tools yet (never connected, sign-in unfinished): nothing to offer.
        if (tools.length === 0) return [];
        return [{ slug: row.slug, name: row.name, tools: tools.slice(0, OFFER_TOOLS) }];
      });
    },

    async enable(conversationId, slug) {
      const owner = await conversationOwner(conversationId);
      if (!owner) return { status: "disabled" };
      const reader: ChatReader = { readChat: (ref) => runtime().readChat(ref) };
      if (await isUnattended(conversationId, reader, owner)) return { status: "unattended" };
      const connection = await db.query.connections.findFirst({
        where: eq(connections.slug, slug),
        columns: { id: true, name: true },
      });
      if (!connection) return { status: "unknown" };
      await db
        .insert(botConnections)
        .values({ botId: owner.bot.id, connectionId: connection.id })
        .onConflictDoNothing();
      await reconcileBotConversation(owner.bot.id, runtime());
      return { status: "enabled", name: connection.name };
    },
  };
}
