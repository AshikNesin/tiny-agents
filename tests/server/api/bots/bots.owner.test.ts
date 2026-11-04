/**
 * Who is behind a conversation (issue #63): a bot's chat or one of its
 * routines' own conversations. Every tool-side lookup resolves through this,
 * so a routine run gets its bot's skills and browser, and is never the
 * owner's turn. Real SQLite test DB.
 */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { db, botSkills, bots, routines, skills } from "../../../../apps/web/src/server/db";
import {
  chatOwner,
  conversationOwner,
  isRoutineConversation,
  isUnattended,
} from "../../../../apps/web/src/server/api/bots/bots.owner";
import { browserTargetForConversation } from "../../../../apps/web/src/server/api/bots/browser.targets";
import { skillStore } from "../../../../apps/web/src/server/api/skills/skills.store";

const botIds: string[] = [];
const skillIds: string[] = [];
afterEach(async () => {
  await db.delete(bots).where(inArray(bots.id, botIds.splice(0)));
  await db.delete(skills).where(inArray(skills.id, skillIds.splice(0)));
});

async function seed() {
  const chat = Math.floor(Math.random() * 1_000_000_000);
  const [bot] = await db
    .insert(bots)
    .values({
      name: randomUUID(),
      modelId: "m",
      conversationId: String(chat),
      browserProfile: "own",
    })
    .returning();
  botIds.push(bot!.id);
  const [routine] = await db
    .insert(routines)
    .values({
      botId: bot!.id,
      name: "digest",
      prompt: "Do it.",
      schedule: { kind: "interval", minutes: 60 },
      conversationId: String(chat + 1),
    })
    .returning();
  return { bot: bot!, routine: routine!, chat, routineConversation: chat + 1 };
}

/** A chat whose latest user message is the given one. */
const reader = (last: { text: string; peer?: unknown }) => ({
  readChat: vi.fn(async () => ({ messages: [{ role: "user", ...last }] }) as never),
});

describe("conversationOwner", () => {
  it("resolves a bot's chat and its routines' conversations to the bot", async () => {
    const { bot, routine, chat, routineConversation } = await seed();
    const fields = {
      id: bot.id,
      name: bot.name,
      modelId: "m",
      browserProfile: "own",
      memoryEnabled: true,
      shared: false,
    };
    expect(await conversationOwner(chat)).toEqual({ kind: "chat", bot: fields });
    expect(await conversationOwner(routineConversation)).toEqual({
      kind: "routine",
      bot: fields,
      routineId: routine.id,
    });
    expect(await conversationOwner(chat + 2)).toBeUndefined();
    expect(await chatOwner(chat)).toEqual(fields);
    expect(await chatOwner(routineConversation)).toBeUndefined();
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
    // A caller that already looked the owner up passes it: no second lookup, same answer.
    const known = await conversationOwner(routineConversation);
    expect(await isUnattended(routineConversation, owner, known)).toBe(true);
  });
});

describe("tool-side lookups from a routine run", () => {
  it("get the bot's browser and skills", async () => {
    const { bot, routineConversation } = await seed();
    expect(await browserTargetForConversation(routineConversation)).toEqual({
      profile: `bot-${bot.id}`,
      tab: bot.id,
    });
    const [skill] = await db
      .insert(skills)
      .values({ name: `skill-${randomUUID()}`, description: "d", body: "b" })
      .returning();
    skillIds.push(skill!.id);
    await db.insert(botSkills).values({ botId: bot.id, skillId: skill!.id });
    expect(await skillStore.list(routineConversation)).toEqual([
      { name: skill!.name, description: "d" },
    ]);
  });
});
