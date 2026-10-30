/**
 * Who is behind a conversation (issue #63): a bot's chat or one of its
 * routines' own conversations. Every tool-side lookup resolves through this,
 * so a routine run gets its bot's skills and browser, and is never the
 * owner's turn. Real SQLite test DB.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import {
  conversationOwner,
  isRoutineConversation,
} from "../../../../apps/web/src/server/api/bots/bots.owner";
import { isUnattended } from "../../../../apps/web/src/server/api/bots/bots.unattended";
import { browserTargetForConversation } from "../../../../apps/web/src/server/api/bots/browser.targets";
import { skillStore } from "../../../../apps/web/src/server/api/skills/skills.store";

const botIds: string[] = [];
const skillIds: string[] = [];
afterEach(async () => {
  await prisma.bot.deleteMany({ where: { id: { in: botIds.splice(0) } } });
  await prisma.skill.deleteMany({ where: { id: { in: skillIds.splice(0) } } });
});

async function seed() {
  const chat = Math.floor(Math.random() * 1_000_000_000);
  const bot = await prisma.bot.create({
    data: { name: randomUUID(), modelId: "m", conversationId: String(chat), browserProfile: "own" },
  });
  botIds.push(bot.id);
  const routine = await prisma.routine.create({
    data: {
      botId: bot.id,
      name: "digest",
      prompt: "Do it.",
      schedule: { kind: "interval", minutes: 60 },
      conversationId: String(chat + 1),
    },
  });
  return { bot, routine, chat, routineConversation: chat + 1 };
}

/** A chat whose latest user message is the given one. */
const reader = (last: { text: string; peer?: unknown }) => ({
  readChat: vi.fn(async () => ({ messages: [{ role: "user", ...last }] }) as never),
});

describe("conversationOwner", () => {
  it("resolves a bot's chat and its routines' conversations to the bot", async () => {
    const { bot, routine, chat, routineConversation } = await seed();
    expect(await conversationOwner(chat)).toEqual({ botId: bot.id });
    expect(await conversationOwner(routineConversation)).toEqual({
      botId: bot.id,
      routineId: routine.id,
    });
    expect(await conversationOwner(chat + 2)).toBeUndefined();
    expect(await isRoutineConversation(chat)).toBe(false);
    expect(await isRoutineConversation(routineConversation)).toBe(true);
  });
});

describe("isUnattended", () => {
  it("a routine's conversation is never the owner's, whatever its messages say", async () => {
    const { chat, routineConversation } = await seed();
    const owner = reader({ text: "Do it." });
    expect(await isUnattended(routineConversation, owner)).toBe(true);
    // Decided by the conversation, not by reading it.
    expect(owner.readChat).not.toHaveBeenCalled();
    expect(await isUnattended(chat, owner)).toBe(false);
    // A chat message that looks like a routine label is still the owner's.
    expect(await isUnattended(chat, reader({ text: '**Routine "digest":** hi' }))).toBe(false);
    expect(await isUnattended(chat, reader({ text: "hi", peer: { kind: "message" } }))).toBe(true);
  });
});

describe("tool-side lookups from a routine run", () => {
  it("get the bot's browser and skills", async () => {
    const { bot, routineConversation } = await seed();
    expect(await browserTargetForConversation(routineConversation)).toEqual({
      profile: `bot-${bot.id}`,
      tab: bot.id,
    });
    const skill = await prisma.skill.create({
      data: { name: `skill-${randomUUID()}`, description: "d", body: "b" },
    });
    skillIds.push(skill.id);
    await prisma.botSkill.create({ data: { botId: bot.id, skillId: skill.id } });
    expect(await skillStore.list(routineConversation)).toEqual([
      { name: skill.name, description: "d" },
    ]);
  });
});
