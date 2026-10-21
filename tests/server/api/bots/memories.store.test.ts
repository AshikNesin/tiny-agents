import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { memoryStore } from "../../../../apps/web/src/server/api/bots/memories.store";

const botIds: string[] = [];
afterEach(async () => {
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
    expect(await memoryStore.list(conversationId)).toEqual([{ ...input, until: null }]);
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
