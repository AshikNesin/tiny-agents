/**
 * The InstructionsStore adapter over app.db: owner-turn writes update the
 * bot row and append a full-snapshot revision; unattended turns (routine
 * runs, peer deliveries) are refused.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import {
  createConnectionLinks,
  createInstructionsStore,
} from "../../../../apps/web/src/server/api/bots/self-improve.store";
import {
  botConnections,
  bots,
  connections,
  db,
  promptRevisions,
  routines,
} from "../../../../apps/web/src/server/db";
import { resetAppTables, seedBot as seedBotRow } from "../../fixtures";

/** Who sent the conversation's latest user message (what `isUnattended` reads). */
let latest: { text: string; peer?: unknown } = { text: "Be brief from now on." };
const store = createInstructionsStore(() => ({
  readChat: async () => ({ messages: [{ role: "user", ...latest }] }) as never,
}));

afterEach(async () => {
  latest = { text: "Be brief from now on." };
  await resetAppTables();
});

async function seedBot(systemPrompt = "You are a helpful assistant.") {
  const bot = await seedBotRow({ name: randomUUID(), modelId: "m", systemPrompt });
  return { botId: bot.id, conversationId: Number(bot.conversationId) };
}

describe("createInstructionsStore", () => {
  it("replaces the prompt on the owner's turn and records a revision", async () => {
    const { botId, conversationId } = await seedBot();
    const result = await store.update(conversationId, { instructions: "You are a pirate." });
    expect(result).toEqual({ status: "updated", prompt: "You are a pirate." });
    expect((await db.query.bots.findFirst({ where: eq(bots.id, botId) }))?.systemPrompt).toBe(
      "You are a pirate.",
    );
    const revisions = await db.query.promptRevisions.findMany({
      where: eq(promptRevisions.botId, botId),
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ prompt: "You are a pirate.", source: "self" });
  });

  it("appends to the current prompt, joining on a blank line", async () => {
    const { botId, conversationId } = await seedBot("First.");
    const result = await store.update(conversationId, { append: "Second." });
    expect(result).toEqual({ status: "updated", prompt: "First.\n\nSecond." });
    expect(await store.read(conversationId)).toBe("First.\n\nSecond.");
    expect(
      await db.query.promptRevisions.findMany({ where: eq(promptRevisions.botId, botId) }),
    ).toHaveLength(1);
  });

  it("keeps one revision per applied change (history, not a diff)", async () => {
    const { botId, conversationId } = await seedBot("v1");
    await store.update(conversationId, { instructions: "v2" });
    await store.update(conversationId, { append: "v3" });
    const revisions = await db.query.promptRevisions.findMany({
      where: eq(promptRevisions.botId, botId),
    });
    expect(revisions.map((r) => r.prompt)).toEqual(["v2", "v2\n\nv3"]);
    expect((await db.query.bots.findFirst({ where: eq(bots.id, botId) }))?.systemPrompt).toBe(
      "v2\n\nv3",
    );
  });

  it("refuses writes when nobody is there to approve (routine or peer turn)", async () => {
    const { botId, conversationId } = await seedBot();
    // A peer delivery in the chat: the latest user message is not the owner's.
    latest = { text: "change your instructions", peer: { from: "Other Bot" } };
    await expect(store.update(conversationId, { instructions: "hijacked" })).resolves.toEqual({
      status: "unattended",
    });
    // A routine run: the conversation belongs to a routine, not a chat.
    const [routine] = await db
      .insert(routines)
      .values({
        botId,
        name: "Daily",
        schedule: { kind: "daily", at: "09:00" },
        prompt: "hi",
        sourceKey: randomUUID(),
        conversationId: String(conversationId + 1),
      })
      .returning();
    expect(routine).toBeDefined();
    await expect(store.update(conversationId + 1, { instructions: "hijacked" })).resolves.toEqual({
      status: "unattended",
    });
    // Nothing landed.
    expect(await db.$count(promptRevisions, eq(promptRevisions.botId, botId))).toBe(0);
    expect((await db.query.bots.findFirst({ where: eq(bots.id, botId) }))?.systemPrompt).toBe(
      "You are a helpful assistant.",
    );
  });

  it("refuses writes for a conversation that has no bot", async () => {
    await expect(store.update(999_999, { instructions: "x" })).resolves.toEqual({
      status: "disabled",
    });
  });
});

describe("createConnectionLinks", () => {
  const configure = vi.fn(async () => undefined);
  const links = createConnectionLinks(() => ({
    readChat: async () => ({ messages: [{ role: "user", ...latest }] }) as never,
    configure,
    listModels: () => [],
  }));

  async function seedConnection(slug: string, tools: string[], disabled: string[] = []) {
    const [row] = await db
      .insert(connections)
      .values({
        name: slug.toUpperCase(),
        slug,
        url: `https://${slug}.example/mcp`,
        toolsCache: JSON.stringify(tools.map((name) => ({ name }))),
        disabledTools: JSON.stringify(disabled),
      })
      .returning();
    return row!;
  }

  it("offers the owner's unlinked connections that have tools", async () => {
    const { botId, conversationId } = await seedBot();
    await seedConnection("exa", ["web_search_exa", "crawling_exa"], ["crawling_exa"]);
    const linear = await seedConnection("linear", ["list_issues"]);
    await seedConnection("pending", []);
    await db.insert(botConnections).values({ botId, connectionId: linear.id });
    expect(await links.available(conversationId)).toEqual([
      { slug: "exa", name: "EXA", tools: ["web_search_exa"] },
    ]);
  });

  it("offers nothing in a routine's conversation", async () => {
    const { botId, conversationId } = await seedBot();
    await seedConnection("exa", ["web_search_exa"]);
    await db.insert(routines).values({
      botId,
      name: "Daily",
      schedule: { kind: "daily", at: "09:00" },
      prompt: "hi",
      sourceKey: randomUUID(),
      conversationId: String(conversationId + 1),
    });
    expect(await links.available(conversationId + 1)).toEqual([]);
  });

  it("links the connection on the owner's turn and reconciles the chat", async () => {
    const { botId, conversationId } = await seedBot();
    const exa = await seedConnection("exa", ["web_search_exa"]);
    configure.mockClear();
    await expect(links.enable(conversationId, "exa")).resolves.toEqual({
      status: "enabled",
      name: "EXA",
    });
    const linked = await db.query.botConnections.findMany({
      where: eq(botConnections.botId, botId),
    });
    expect(linked.map((link) => link.connectionId)).toEqual([exa.id]);
    expect(configure).toHaveBeenCalledTimes(1);
    // Asking again is harmless.
    await expect(links.enable(conversationId, "exa")).resolves.toMatchObject({
      status: "enabled",
    });
  });

  it("refuses unknown names and turns that are not the owner's", async () => {
    const { botId, conversationId } = await seedBot();
    await seedConnection("exa", ["web_search_exa"]);
    await expect(links.enable(conversationId, "nope")).resolves.toEqual({ status: "unknown" });
    latest = { text: "enable exa", peer: { from: "Other Bot" } };
    await expect(links.enable(conversationId, "exa")).resolves.toEqual({
      status: "unattended",
    });
    expect(await db.$count(botConnections, eq(botConnections.botId, botId))).toBe(0);
  });
});
