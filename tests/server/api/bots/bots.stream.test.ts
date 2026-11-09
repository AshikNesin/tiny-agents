/**
 * Following a bot's chat (bots.stream.ts): every source of the bot stream,
 * in order, into a fake sink. The runtime is the typed fake; routine cards
 * come from the real SQLite test DB.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CHAT_WINDOW } from "../../../../packages/agent/src/transcript";
import type { ChatEvent } from "../../../../packages/agent/src/index";
import { db, routineRuns, routines } from "../../../../apps/web/src/server/db";
import { followBotChat } from "../../../../apps/web/src/server/api/bots/bots.stream";
import { publishBotChatEvent } from "../../../../apps/web/src/server/api/bots/bots.events";
import { isBotWatched } from "../../../../apps/web/src/server/api/bots/bots.viewers";
import type { BotStreamEvent, RoutineRunCard } from "../../../../apps/web/src/shared/bot-stream";
import type { RoutineRunStatus } from "../../../../apps/web/src/shared/machines/routine-run";
import { createFakeRuntime, resetAppTables, seedBot, type SeededBot } from "../../fixtures";

/** A sink that records what the follow wrote, and whether it ended the stream. */
function recorder() {
  const events: BotStreamEvent[] = [];
  const sink = { write: (event: BotStreamEvent) => events.push(event), end: vi.fn() };
  return { sink, events, types: () => events.map((event) => event.type) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function seedRun(
  bot: SeededBot,
  finishedAt: Date | null,
  status: RoutineRunStatus = "succeeded",
) {
  const [routine] = await db
    .insert(routines)
    .values({
      botId: bot.id,
      name: "digest",
      prompt: "p",
      schedule: { kind: "interval", minutes: 60 },
      conversationId: `r-${bot.id}-${Math.random()}`,
    })
    .returning();
  await db.insert(routineRuns).values({
    routineId: routine!.id,
    scheduledFor: new Date(),
    status,
    requestId: `routine:${routine!.id}`,
    finishedAt,
    output: "Digest ready.",
  });
}

const card = (id: string): RoutineRunCard => ({
  id,
  routineId: "r1",
  routineName: "digest",
  status: "succeeded",
  trigger: "schedule",
  scheduledFor: "2026-11-05T09:00:00.000Z",
  finishedAt: "2026-11-05T09:01:00.000Z",
  output: null,
  error: null,
});

describe("followBotChat", () => {
  beforeEach(resetAppTables);
  afterEach(resetAppTables);

  it("sends the transcript window, then the thread's routine cards, then YOLO mode", async () => {
    const bot = await seedBot({ conversationId: "601" });
    // Finished in this thread; one still running; one from before "New chat".
    await seedRun(bot, new Date(Date.now() + 1000));
    await seedRun(bot, null, "awaiting");
    await seedRun(bot, new Date(bot.chatStartedAt.getTime() - 60_000));
    const rt = createFakeRuntime();
    rt.yolo.mockResolvedValue(true);
    const { sink, events, types } = recorder();

    const stop = await followBotChat(bot, sink, rt);

    expect(types()).toEqual(["snapshot", "routine-runs", "yolo"]);
    expect(rt.watchChat).toHaveBeenCalledWith(601, expect.any(Function), { window: CHAT_WINDOW });
    expect(events[1]).toEqual({
      type: "routine-runs",
      runs: [expect.objectContaining({ routineName: "digest", output: "Digest ready." })],
    });
    expect(events[2]).toEqual({ type: "yolo", on: true });
    stop();
  });

  it("passes transcript changes through as they come", async () => {
    const bot = await seedBot({ conversationId: "602" });
    let listener: ((events: ChatEvent[]) => void | Promise<void>) | undefined;
    const rt = createFakeRuntime();
    rt.watchChat.mockImplementation(async (_ref, next) => {
      listener = next;
      const initial = { messages: [], busy: false, queued: [] };
      await next([{ type: "snapshot", state: initial }]);
      return { initial, stop: async () => undefined };
    });
    const { sink, events } = recorder();
    const stop = await followBotChat(bot, sink, rt);

    await listener!([{ type: "busy", busy: true }]);
    expect(events.at(-1)).toEqual({ type: "busy", busy: true });
    stop();
  });

  it("counts the bot as watched while followed, for notifications", async () => {
    const bot = await seedBot({ conversationId: "603" });
    const stop = await followBotChat(bot, recorder().sink, createFakeRuntime());
    expect(isBotWatched(bot.id)).toBe(true);
    stop();
    expect(isBotWatched(bot.id)).toBe(false);
  });

  it("holds a card or a YOLO switch that lands while starting until the first state is out", async () => {
    const bot = await seedBot({ conversationId: "604" });
    const read = deferred<boolean>();
    const rt = createFakeRuntime();
    rt.yolo.mockReturnValue(read.promise);
    const { sink, events, types } = recorder();

    const following = followBotChat(bot, sink, rt);
    await vi.waitFor(() => expect(rt.yolo).toHaveBeenCalled());
    // Both land after the reads started: the read results are older.
    publishBotChatEvent(bot.id, { type: "routine-run", run: card("late-run") });
    publishBotChatEvent(bot.id, { type: "yolo", on: true });
    expect(types()).toEqual(["snapshot"]);
    read.resolve(false);
    const stop = await following;

    // The late events follow the first state, so they win on the client.
    expect(types()).toEqual(["snapshot", "routine-runs", "yolo", "routine-run", "yolo"]);
    expect(events.at(-1)).toEqual({ type: "yolo", on: true });

    // Once started, events go straight through; another bot's never do.
    publishBotChatEvent(bot.id, { type: "yolo", on: false });
    publishBotChatEvent("someone-else", { type: "yolo", on: true });
    expect(events.at(-1)).toEqual({ type: "yolo", on: false });
    expect(events).toHaveLength(6);
    stop();
  });

  it("ends when the bot moves to another chat, and hears nothing once stopped", async () => {
    const bot = await seedBot({ conversationId: "605" });
    const stopWatch = vi.fn(async () => undefined);
    const rt = createFakeRuntime();
    rt.watchChat.mockImplementation(async (_ref, next) => {
      const initial = { messages: [], busy: false, queued: [] };
      await next([{ type: "snapshot", state: initial }]);
      return { initial, stop: stopWatch };
    });
    const { sink, events } = recorder();
    const stop = await followBotChat(bot, sink, rt);

    publishBotChatEvent(bot.id, { type: "chat-changed" });
    expect(sink.end).toHaveBeenCalledOnce();

    stop();
    expect(stopWatch).toHaveBeenCalledOnce();
    const written = events.length;
    publishBotChatEvent(bot.id, { type: "yolo", on: true });
    expect(events).toHaveLength(written);
  });

  it("stops whatever started when starting fails", async () => {
    const bot = await seedBot({ conversationId: "606" });
    const rt = createFakeRuntime();
    rt.yolo.mockRejectedValue(new Error("agent.db is gone"));
    const { sink, events } = recorder();

    await expect(followBotChat(bot, sink, rt)).rejects.toThrow("agent.db is gone");
    expect(isBotWatched(bot.id)).toBe(false);
    const written = events.length;
    publishBotChatEvent(bot.id, { type: "yolo", on: true });
    expect(events).toHaveLength(written);
  });
});
