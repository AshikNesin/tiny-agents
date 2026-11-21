import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { chatCards } from "../../../apps/web/src/server/api/routines/routines.cards";
import { listPastChats, readPastChat } from "../../../apps/web/src/server/api/bots/chats.history";
import {
  continuePastChat,
  resetConversation,
} from "../../../apps/web/src/server/api/bots/chats.service";
import { bots, db, routineRuns, routines } from "../../../apps/web/src/server/db";
import { installFakeRuntime, resetAppTables, seedBot } from "../fixtures";

const MINUTE = 60_000;

beforeEach(resetAppTables);
afterEach(resetAppTables);

const botRow = async (id: string) => (await db.query.bots.findFirst({ where: eq(bots.id, id) }))!;

describe("U9: continuing a past chat", () => {
  it("shows a routine card that finished in the chat in between in both chats", async () => {
    const fake = installFakeRuntime();
    const start = Date.now();
    const bot = await seedBot({ name: "Scheduler", chatStartedAt: new Date(start) });
    const chatA = bot.conversationId;
    fake.script.say(Number(chatA), "hello from chat A", "hi");

    vi.setSystemTime(start + 10 * MINUTE);
    await resetConversation(bot.id);
    const chatB = (await botRow(bot.id)).conversationId;
    expect((await botRow(bot.id)).chatStartedAt).toEqual(new Date(start + 10 * MINUTE));
    fake.script.say(Number(chatB), "hello from chat B", "hi");

    const [routine] = await db
      .insert(routines)
      .values({
        botId: bot.id,
        name: "Standup",
        prompt: "Post the standup",
        schedule: { kind: "cron", expr: "0 9 * * *" },
      })
      .returning();
    const [run] = await db
      .insert(routineRuns)
      .values({
        routineId: routine!.id,
        scheduledFor: new Date(start + 20 * MINUTE),
        status: "succeeded",
        trigger: "schedule",
        requestId: "u9-run-1",
        finishedAt: new Date(start + 20 * MINUTE),
        output: "Standup posted",
      })
      .returning();
    expect(
      (await chatCards(bot.id, (await botRow(bot.id)).chatStartedAt)).map((c) => c.id),
    ).toEqual([run!.id]);

    vi.setSystemTime(start + 30 * MINUTE);
    const pastA = (await listPastChats(bot.id)).find((chat) => chat.startedAt.getTime() === start);
    await continuePastChat(bot.id, pastA!.id);
    const continued = await botRow(bot.id);
    expect(continued.conversationId).toBe(chatA);
    expect(continued.chatStartedAt).toEqual(new Date(start));

    const live = await chatCards(bot.id, continued.chatStartedAt);
    expect(live.map((card) => card.id)).toEqual([run!.id]);

    const pastB = (await listPastChats(bot.id)).find(
      (chat) => chat.startedAt.getTime() === start + 10 * MINUTE,
    );
    expect(pastB).toMatchObject({ endedAt: new Date(start + 30 * MINUTE) });
    const readB = await readPastChat(bot.id, pastB!.id, fake);
    expect(readB.runs.map((card) => card.id)).toEqual([run!.id]);
  });
});
