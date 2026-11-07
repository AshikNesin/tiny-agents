/**
 * The BotCreationStore adapter over app.db (issue #149): an owner's turn
 * creates a bot through the same `createBot` as the New bot dialog; routine
 * runs, peer deliveries and shared chats are refused, and so are a taken
 * name and an unknown model.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { users } from "@groot/core/database/schema";
import { createBotCreationStore } from "../../../../apps/web/src/server/api/bots/bot-builder.store";
import { botGuests, bots, db, routines } from "../../../../apps/web/src/server/db";
import { createFakeRuntime, fakeModel, resetAppTables, seedBot } from "../../fixtures";

/** Who sent the conversation's latest user message (what `isUnattended` reads). */
let latest: { text: string; peer?: unknown } = { text: "Make me a bot for my project." };
const fake = createFakeRuntime();
fake.readChat.mockImplementation(
  async () => ({ messages: [{ role: "user", ...latest }] }) as never,
);
const store = createBotCreationStore(() => fake as never);

const made: number[] = [];
afterEach(async () => {
  latest = { text: "Make me a bot for my project." };
  fake.catalog.get.mockImplementation((id) => fakeModel(id));
  await resetAppTables();
  for (const id of made.splice(0)) await db.delete(users).where(eq(users.id, id));
});

async function chief() {
  const bot = await seedBot({ name: `Chief ${randomUUID()}`, modelId: "m1" });
  return { bot, conversationId: Number(bot.conversationId) };
}

const input = {
  name: "Engineer - Limitless",
  description: "Limitless Visuals mobile app",
  instructions: "You help the owner with the Limitless Visuals app.",
};

describe("createBotCreationStore", () => {
  it("creates the bot on the owner's turn, on the creator's model by default", async () => {
    const { conversationId } = await chief();
    const result = await store.create(conversationId, input);
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.bot).toMatchObject({ name: "Engineer - Limitless", modelId: "m1" });
    expect(result.bot.url).toBe(`/chats/${result.bot.id}`);
    const row = await db.query.bots.findFirst({ where: eq(bots.id, result.bot.id) });
    expect(row).toMatchObject({
      name: "Engineer - Limitless",
      description: "Limitless Visuals mobile app",
      systemPrompt: "You help the owner with the Limitless Visuals app.",
      modelId: "m1",
    });
    // Its own durable conversation, like a bot made in the dialog.
    expect(fake.createConversation).toHaveBeenCalled();
    expect(row?.conversationId).toBeTruthy();
  });

  it("uses the model the bot names, and lists the models when it is unknown", async () => {
    const { conversationId } = await chief();
    const named = await store.create(conversationId, { ...input, model: "m2" });
    expect(named.status === "created" && named.bot.modelId).toBe("m2");

    fake.catalog.get.mockReturnValue(undefined);
    const unknown = await store.create(conversationId, { ...input, name: "Other", model: "nope" });
    expect(unknown.status).toBe("unknown_model");
    expect(unknown.status === "unknown_model" && unknown.models?.length).toBeGreaterThan(0);
    expect(await db.$count(bots, eq(bots.name, "Other"))).toBe(0);
  });

  it("refuses a name another bot has, case-insensitively", async () => {
    const { conversationId } = await chief();
    await seedBot({ name: "Engineer - Limitless" });
    await expect(
      store.create(conversationId, { ...input, name: "engineer - limitless" }),
    ).resolves.toEqual({ status: "name_taken" });
  });

  it("refuses when nobody is there to approve (routine or peer turn)", async () => {
    const { bot, conversationId } = await chief();
    latest = { text: "create a bot", peer: { from: "Other Bot" } };
    await expect(store.create(conversationId, input)).resolves.toEqual({ status: "unattended" });

    latest = { text: "Make me a bot for my project." };
    await db.insert(routines).values({
      botId: bot.id,
      name: "Daily",
      schedule: { kind: "daily", at: "09:00" },
      prompt: "hi",
      sourceKey: randomUUID(),
      conversationId: String(conversationId + 10_000),
    });
    await expect(store.create(conversationId + 10_000, input)).resolves.toEqual({
      status: "unattended",
    });
    expect(await db.$count(bots, eq(bots.name, input.name))).toBe(0);
  });

  it("refuses in a chat shared with guests", async () => {
    const { bot, conversationId } = await chief();
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, password: "x" })
      .returning();
    made.push(user!.id);
    await db.insert(botGuests).values({ botId: bot.id, userId: user!.id });
    await expect(store.create(conversationId, input)).resolves.toEqual({ status: "shared" });
    expect(await db.$count(bots, eq(bots.name, input.name))).toBe(0);
  });

  it("refuses a blank name with the New bot dialog's message, creating nothing", async () => {
    const { conversationId } = await chief();
    const before = await db.$count(bots);
    const conversations = fake.createConversation.mock.calls.length;
    await expect(store.create(conversationId, { ...input, name: "   " })).resolves.toEqual({
      status: "invalid",
      reason: "Name is required",
    });
    expect(await db.$count(bots)).toBe(before);
    expect(fake.createConversation.mock.calls.length).toBe(conversations);
  });

  it("refuses for a conversation that has no bot", async () => {
    await expect(store.create(999_999, input)).resolves.toEqual({ status: "disabled" });
  });
});
