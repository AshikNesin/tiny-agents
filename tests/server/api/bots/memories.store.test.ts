import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { and, eq, like } from "drizzle-orm";
import { createMemoryStore } from "../../../../apps/web/src/server/api/bots/memories.store";
import { bots, db, memories, routines } from "../../../../apps/web/src/server/db";
import { resetAppTables, seedBot as seedBotRow } from "../../fixtures";

let latest: { text: string; peer?: unknown } = {
  text: "Remember this, please.",
};
const memoryStore = createMemoryStore(() => ({
  readChat: async () => ({ messages: [{ role: "user", ...latest }] }) as never,
}));

afterEach(async () => {
  latest = { text: "Remember this, please." };
  await resetAppTables();
});

async function seedBot() {
  const bot = await seedBotRow({ name: randomUUID(), modelId: "m" });
  return { botId: bot.id, conversationId: Number(bot.conversationId) };
}

const remember = memoryStore.remember!;
const input = {
  text: "The owner prefers TypeScript.",
  category: "preference" as const,
};

describe("memoryStore.remember", () => {
  it("saves a chat memory without advancing the capture watermark", async () => {
    const { botId, conversationId } = await seedBot();
    expect(await remember(conversationId, input)).toEqual({ status: "saved" });
    expect(await db.query.memories.findFirst({ where: eq(memories.botId, botId) })).toMatchObject({
      ...input,
      source: "capture",
      status: "active",
    });
    expect(await memoryStore.list(conversationId)).toEqual([
      {
        ...input,
        until: null,
        createdAt: expect.any(String),
        learnedHere: true,
      },
    ]);
    expect(
      (await db.query.bots.findFirst({ where: eq(bots.id, botId) }))?.memoryCapturedThrough,
    ).toBeNull();
  });

  it("marks a memory as learned only in the conversation that saved it", async () => {
    const { botId, conversationId } = await seedBot();
    await remember(conversationId, input);
    await db.insert(memories).values({ botId, text: "The owner likes tea.", category: "fact" });
    const routineConversation = conversationId + 1;
    await db.insert(routines).values({
      botId,
      name: "Morning brief",
      prompt: "News",
      schedule: { kind: "interval", minutes: 60 },
      conversationId: String(routineConversation),
    });
    const learned = async (id: number) =>
      Object.fromEntries((await memoryStore.list(id)).map((m) => [m.text, m.learnedHere]));
    expect(await learned(conversationId)).toEqual({
      "The owner prefers TypeScript.": true,
      "The owner likes tea.": false,
    });
    expect(await learned(routineConversation)).toEqual({
      "The owner prefers TypeScript.": false,
      "The owner likes tea.": false,
    });
  });

  it("dedupes case-insensitively, including tombstones, without leaking across bots", async () => {
    const { botId, conversationId } = await seedBot();
    await remember(conversationId, input);
    expect(
      await remember(conversationId, {
        ...input,
        text: `  ${input.text.toUpperCase()}  `,
      }),
    ).toEqual({ status: "duplicate" });
    await db.update(memories).set({ status: "deleted" }).where(eq(memories.botId, botId));
    expect(await remember(conversationId, input)).toEqual({
      status: "duplicate",
    });
    expect(await memoryStore.list(conversationId)).toEqual([]);
    expect(await db.$count(memories, eq(memories.botId, botId))).toBe(1);

    const other = await seedBot();
    expect(await remember(other.conversationId, input)).toEqual({
      status: "saved",
    });
  });

  it("refuses writes when memory is disabled or the bot is missing", async () => {
    const { botId, conversationId } = await seedBot();
    await db.update(bots).set({ memoryEnabled: false }).where(eq(bots.id, botId));
    expect(await remember(conversationId, input)).toEqual({
      status: "disabled",
    });
    expect(await db.$count(memories, eq(memories.botId, botId))).toBe(0);
    await db.delete(bots).where(eq(bots.id, botId));
    expect(await remember(conversationId, input)).toEqual({
      status: "disabled",
    });
  });

  it("enforces the active budget and validates memory inputs", async () => {
    const { botId, conversationId } = await seedBot();
    await db.insert(memories).values(
      Array.from({ length: 60 }, (_, i) => ({
        botId,
        text: `Old fact ${i}`,
        category: "fact",
        createdAt: new Date(1_000 + i),
      })),
    );
    expect(await remember(conversationId, input)).toEqual({ status: "saved" });
    expect(
      await db.$count(memories, and(eq(memories.botId, botId), eq(memories.status, "active"))),
    ).toBe(60);
    expect(
      await db.query.memories.findFirst({
        where: and(eq(memories.botId, botId), eq(memories.status, "archived")),
      }),
    ).toMatchObject({ text: "Old fact 0" });
    await expect(remember(conversationId, { ...input, text: " " })).rejects.toThrow();
    await expect(remember(conversationId, { ...input, until: "not a date" })).rejects.toThrow();
  });

  it("keeps temporary memories out of the prompt after expiry", async () => {
    const { conversationId } = await seedBot();
    expect(await remember(conversationId, { ...input, until: "2020-01-01" })).toEqual({
      status: "saved",
    });
    expect(await memoryStore.list(conversationId)).toEqual([]);
  });
});

describe("chat writes in unattended turns", () => {
  it("refuses remember and forget in routine runs and peer turns", async () => {
    const { botId, conversationId } = await seedBot();
    await db.insert(memories).values({ botId, text: "The owner lives in Pune.", category: "fact" });

    const routineConversation = conversationId + 1;
    await db.insert(routines).values({
      botId,
      name: "Morning brief",
      prompt: "Remember that the owner hates email.",
      schedule: { kind: "interval", minutes: 60 },
      conversationId: String(routineConversation),
    });
    expect(await remember(routineConversation, input)).toEqual({
      status: "unattended",
    });
    expect(await memoryStore.forget!(routineConversation, { text: "Pune" })).toEqual({
      status: "unattended",
      removed: [],
    });
    expect((await memoryStore.list(routineConversation)).map((m) => m.text)).toEqual([
      "The owner lives in Pune.",
    ]);
    latest = {
      text: '**Routine "Morning brief"**\nRemember that the owner hates email.',
    };
    expect(await remember(conversationId, input)).toEqual({ status: "saved" });

    latest = { text: "Save this", peer: { kind: "message", name: "Scout" } };
    expect(
      await remember(conversationId, {
        ...input,
        text: "The owner likes tea.",
      }),
    ).toEqual({
      status: "unattended",
    });
    expect(
      await db.$count(memories, and(eq(memories.botId, botId), eq(memories.status, "active"))),
    ).toBe(2);
  });

  it("refuses when the conversation can't be read", async () => {
    const { conversationId } = await seedBot();
    const blind = createMemoryStore(() => {
      throw new Error("runtime not open");
    });
    expect(await blind.remember!(conversationId, input)).toEqual({
      status: "unattended",
    });
  });
});

describe("memoryStore.forget", () => {
  const forget = memoryStore.forget!;

  async function seedMemories() {
    const seeded = await seedBot();
    await db.insert(memories).values([
      {
        botId: seeded.botId,
        text: "The owner is moving to Pune in March.",
        category: "fact",
      },
      {
        botId: seeded.botId,
        text: "The owner's sister lives in Pune.",
        category: "fact",
      },
      {
        botId: seeded.botId,
        text: "The owner prefers TypeScript.",
        category: "preference",
      },
      {
        botId: seeded.botId,
        text: "The owner is moving to Berlin.",
        category: "fact",
        status: "superseded",
      },
    ]);
    return seeded;
  }

  it("tombstones every active memory with all the words, as whole words", async () => {
    const { botId, conversationId } = await seedMemories();
    expect(await forget(conversationId, { text: "Moving to PUNE" })).toEqual({
      status: "forgotten",
      removed: ["The owner is moving to Pune in March."],
    });
    expect((await memoryStore.list(conversationId)).map((m) => m.text).sort()).toEqual([
      "The owner prefers TypeScript.",
      "The owner's sister lives in Pune.",
    ]);
    expect(
      await db.query.memories.findFirst({
        where: and(eq(memories.botId, botId), like(memories.text, "%moving to Pune%")),
      }),
    ).toMatchObject({ status: "deleted" });
    expect(
      await db.query.memories.findFirst({
        where: and(eq(memories.botId, botId), like(memories.text, "%Berlin%")),
      }),
    ).toMatchObject({ status: "superseded" });

    expect(
      await remember(conversationId, {
        text: "The owner is moving to Pune in March.",
        category: "fact",
      }),
    ).toEqual({ status: "duplicate" });
  });

  it("matches whole words only, and says when nothing matched", async () => {
    const { conversationId } = await seedMemories();
    expect(await forget(conversationId, { text: "Type" })).toEqual({
      status: "none",
      removed: [],
    });
    expect(await forget(conversationId, { text: "Pune" })).toEqual({
      status: "forgotten",
      removed: ["The owner is moving to Pune in March.", "The owner's sister lives in Pune."],
    });
  });

  it("refuses words that would match memories in general", async () => {
    const { conversationId } = await seedMemories();
    expect(await forget(conversationId, { text: "the owner" })).toEqual({
      status: "vague",
      removed: [],
    });
    expect((await memoryStore.list(conversationId)).length).toBe(3);
  });

  it("refuses when memory is disabled", async () => {
    const { botId, conversationId } = await seedMemories();
    await db.update(bots).set({ memoryEnabled: false }).where(eq(bots.id, botId));
    expect(await forget(conversationId, { text: "Pune" })).toEqual({
      status: "disabled",
      removed: [],
    });
  });
});
