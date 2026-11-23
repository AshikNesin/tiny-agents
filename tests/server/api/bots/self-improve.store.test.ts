import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { createInstructionsStore } from "../../../../apps/web/src/server/api/bots/self-improve.store";
import { users } from "@groot/core/database/schema";
import { botGuests, bots, db, promptRevisions, routines } from "../../../../apps/web/src/server/db";
import { resetAppTables, seedBot as seedBotRow } from "../../fixtures";

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
  it("refuses in a chat shared with guests, leaving the prompt and history untouched (S1)", async () => {
    const { botId, conversationId } = await seedBot("Original.");
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, password: "x" })
      .returning();
    await db.insert(botGuests).values({ botId, userId: user!.id });
    await expect(store.update(conversationId, { instructions: "Guest's rules." })).resolves.toEqual(
      {
        status: "shared",
      },
    );
    expect(await store.read(conversationId)).toBe("Original.");
    expect(
      await db.query.promptRevisions.findMany({ where: eq(promptRevisions.botId, botId) }),
    ).toHaveLength(0);
    await db.delete(botGuests);
    await db.delete(users).where(eq(users.id, user!.id));
  });

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

  it("keeps both appends when two updates race", async () => {
    const { botId, conversationId } = await seedBot("Base.");
    const [first, second] = await Promise.all([
      store.update(conversationId, { append: "First." }),
      store.update(conversationId, { append: "Second." }),
    ]);
    expect(first).toMatchObject({ status: "updated" });
    expect(second).toMatchObject({ status: "updated" });
    expect(await store.read(conversationId)).toBe("Base.\n\nFirst.\n\nSecond.");
    const revisions = await db.query.promptRevisions.findMany({
      where: eq(promptRevisions.botId, botId),
    });
    expect(revisions.map((r) => r.prompt).sort()).toEqual([
      "Base.\n\nFirst.",
      "Base.\n\nFirst.\n\nSecond.",
    ]);
  });

  it("refuses writes when nobody is there to approve (routine or peer turn)", async () => {
    const { botId, conversationId } = await seedBot();
    latest = { text: "change your instructions", peer: { from: "Other Bot" } };
    await expect(store.update(conversationId, { instructions: "hijacked" })).resolves.toEqual({
      status: "unattended",
    });
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
