import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { createMemoryStore } from "../../../../apps/web/src/server/api/bots/memories.store";

/** Who sent the conversation's latest user message (what `isUnattended` reads). */
let latest: { text: string; peer?: unknown } = { text: "Remember this, please." };
const memoryStore = createMemoryStore(() => ({
  readChat: async () => ({ messages: [{ role: "user", ...latest }] }) as never,
}));

const botIds: string[] = [];
afterEach(async () => {
  latest = { text: "Remember this, please." };
  await prisma.bot.deleteMany({ where: { id: { in: botIds.splice(0) } } });
});

async function seedBot() {
  const conversationId = Math.floor(Math.random() * 1_000_000_000);
  const bot = await prisma.bot.create({
    data: { name: randomUUID(), conversationId: String(conversationId), modelId: "m" },
  });
  botIds.push(bot.id);
  return { botId: bot.id, conversationId };
}

const remember = memoryStore.remember!;
const input = { text: "The owner prefers TypeScript.", category: "preference" as const };

describe("memoryStore.remember", () => {
  it("saves a chat memory without advancing the capture watermark", async () => {
    const { botId, conversationId } = await seedBot();
    expect(await remember(conversationId, input)).toEqual({ status: "saved" });
    expect(await prisma.memory.findFirst({ where: { botId } })).toMatchObject({
      ...input,
      source: "capture",
      status: "active",
    });
    expect(await memoryStore.list(conversationId)).toEqual([
      { ...input, until: null, createdAt: expect.any(String) },
    ]);
    expect(
      (await prisma.bot.findUnique({ where: { id: botId } }))?.memoryCapturedThrough,
    ).toBeNull();
  });

  it("dedupes case-insensitively, including tombstones, without leaking across bots", async () => {
    const { botId, conversationId } = await seedBot();
    await remember(conversationId, input);
    expect(
      await remember(conversationId, { ...input, text: `  ${input.text.toUpperCase()}  ` }),
    ).toEqual({ status: "duplicate" });
    await prisma.memory.updateMany({ where: { botId }, data: { status: "deleted" } });
    expect(await remember(conversationId, input)).toEqual({ status: "duplicate" });
    expect(await memoryStore.list(conversationId)).toEqual([]);
    expect(await prisma.memory.count({ where: { botId } })).toBe(1);

    const other = await seedBot();
    expect(await remember(other.conversationId, input)).toEqual({ status: "saved" });
  });

  it("refuses writes when memory is disabled or the bot is missing", async () => {
    const { botId, conversationId } = await seedBot();
    await prisma.bot.update({ where: { id: botId }, data: { memoryEnabled: false } });
    expect(await remember(conversationId, input)).toEqual({ status: "disabled" });
    expect(await prisma.memory.count({ where: { botId } })).toBe(0);
    await prisma.bot.delete({ where: { id: botId } });
    expect(await remember(conversationId, input)).toEqual({ status: "disabled" });
  });

  it("enforces the active budget and validates memory inputs", async () => {
    const { botId, conversationId } = await seedBot();
    await prisma.memory.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        botId,
        text: `Old fact ${i}`,
        category: "fact",
        createdAt: new Date(1_000 + i),
      })),
    });
    expect(await remember(conversationId, input)).toEqual({ status: "saved" });
    expect(await prisma.memory.count({ where: { botId, status: "active" } })).toBe(100);
    expect(await prisma.memory.findFirst({ where: { botId, status: "archived" } })).toMatchObject({
      text: "Old fact 0",
    });
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
    await prisma.memory.create({
      data: { botId, text: "The owner lives in Pune.", category: "fact" },
    });

    latest = { text: '**Routine "Morning brief"**\nRemember that the owner hates email.' };
    expect(await remember(conversationId, input)).toEqual({ status: "unattended" });
    expect(await memoryStore.forget!(conversationId, { text: "Pune" })).toEqual({
      status: "unattended",
      removed: [],
    });

    latest = { text: "Save this", peer: { kind: "message", name: "Scout" } };
    expect(await remember(conversationId, input)).toEqual({ status: "unattended" });
    expect(await prisma.memory.count({ where: { botId, status: "active" } })).toBe(1);
  });

  it("refuses when the conversation can't be read", async () => {
    const { conversationId } = await seedBot();
    const blind = createMemoryStore(() => {
      throw new Error("runtime not open");
    });
    expect(await blind.remember!(conversationId, input)).toEqual({ status: "unattended" });
  });
});

describe("memoryStore.forget", () => {
  const forget = memoryStore.forget!;

  async function seedMemories() {
    const seeded = await seedBot();
    await prisma.memory.createMany({
      data: [
        { botId: seeded.botId, text: "The owner is moving to Pune in March.", category: "fact" },
        { botId: seeded.botId, text: "The owner's sister lives in Pune.", category: "fact" },
        { botId: seeded.botId, text: "The owner prefers TypeScript.", category: "preference" },
        {
          botId: seeded.botId,
          text: "The owner is moving to Berlin.",
          category: "fact",
          status: "superseded",
        },
      ],
    });
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
      await prisma.memory.findFirst({ where: { botId, text: { contains: "moving to Pune" } } }),
    ).toMatchObject({ status: "deleted" });
    // Superseded history is not touched.
    expect(
      await prisma.memory.findFirst({ where: { botId, text: { contains: "Berlin" } } }),
    ).toMatchObject({ status: "superseded" });

    // A deleted fact is never re-added by a chat save either.
    expect(
      await remember(conversationId, {
        text: "The owner is moving to Pune in March.",
        category: "fact",
      }),
    ).toEqual({ status: "duplicate" });
  });

  it("matches whole words only, and says when nothing matched", async () => {
    const { conversationId } = await seedMemories();
    expect(await forget(conversationId, { text: "Type" })).toEqual({ status: "none", removed: [] });
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
    await prisma.bot.update({ where: { id: botId }, data: { memoryEnabled: false } });
    expect(await forget(conversationId, { text: "Pune" })).toEqual({
      status: "disabled",
      removed: [],
    });
  });
});
