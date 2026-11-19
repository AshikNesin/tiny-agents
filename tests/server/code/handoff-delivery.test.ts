/**
 * Register row C7 (fixed in 4.6): Code hand-offs are started once and
 * finished at least once, into the bot's real chat, which takes each finish
 * once (the submit is idempotent by request id).
 *
 * - A finish is owed durably with the hand-off's running → finished move,
 *   so a crash before (or during) its delivery leaves it owed, and the next
 *   watcher (a restart) or the retry timer sends it until it lands.
 * - A replayed `code_start` makes one thread, while the first run is still
 *   starting and after a restart interrupted it.
 * - A follow-up arms its hand-off before the harness hears it, and a
 *   thread's sends run one at a time.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  botMessages,
  codeHandoffs,
  db,
  routineRuns,
  routines,
} from "../../../apps/web/src/server/db";
import { startSettledPipeline } from "../../../apps/web/src/server/api/bots/bots.settled";
import type { AgentRuntime } from "../../../packages/agent/src/index";
import type { TurnOutcome } from "@tiny-agents/code/contracts";
import { codeStore, deliverHandoffFinish } from "../../../apps/web/src/server/api/code/code.bots";
import {
  createCodeHub,
  setCodeHub,
  type CodeHub,
} from "../../../apps/web/src/server/api/code/code.hub";
import {
  claimHandoff,
  finishHandoffOnce,
  owedFinishes,
  recordHandoff,
  runningHandoffs,
} from "../../../apps/web/src/server/api/code/code.store";
import {
  startCodeWatcher,
  type WatcherDeps,
} from "../../../apps/web/src/server/api/code/code.watcher";
import {
  closeAppRuntime,
  eventually,
  openAppRuntime,
  resetAppTables,
  seedBot,
  TEST_MODEL,
  type SeededBot,
} from "../fixtures";
import { fakeHarness, type FakeHarness } from "./fake-harness";

let runtime: AgentRuntime;
let harness: FakeHarness;
let hub: CodeHub;
const stops: Array<() => void> = [];

beforeEach(async () => {
  await resetAppTables();
  runtime = await openAppRuntime();
  harness = fakeHarness();
  hub = setCodeHub(createCodeHub({ instances: [harness], listDebounceMs: 5 }))!;
});

afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  setCodeHub(undefined);
  await closeAppRuntime();
  await resetAppTables();
});

const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the app does with a finish: a reply from the harness, back where it was asked. */
const intoChat: WatcherDeps["deliver"] = (finish) => deliverHandoffFinish(runtime, finish);

/** A watcher, as one process runs it; the returned stop is that process dying. */
function watch(deliver: WatcherDeps["deliver"] = intoChat, retryMs = 60_000): () => void {
  const stop = startCodeWatcher({ hub, deliver, notify: () => {}, retryMs });
  stops.push(stop);
  return stop;
}

/** The finishes in the bot's chat, or in another of its conversations. */
async function finishesIn(where: SeededBot | number): Promise<string[]> {
  const ref = typeof where === "number" ? where : Number(where.conversationId);
  const state = await runtime.readChat(ref);
  return state.messages
    .filter((message) => message.role === "user" && message.requestId?.startsWith("code-"))
    .map((message) => message.text);
}

const ended = (text: string, cursor: number): TurnOutcome => ({
  working: false,
  title: "fix-login",
  cwd: "/repo",
  text,
  failed: false,
  endedAt: Date.now() + 1000,
  cursor,
});

const working: TurnOutcome = {
  working: true,
  title: "fix-login",
  cwd: "/repo",
  text: "",
  failed: false,
  cursor: 0,
};

const ok = <T extends object>(value: T | { error: string }): T => {
  if ("error" in value) throw new Error(value.error);
  return value;
};

describe("hand-off finishes (C7a: at least once, never twice)", () => {
  async function handOff(bot: SeededBot, nativeId: string) {
    await recordHandoff({
      botId: bot.id,
      conversationId: bot.conversationId,
      idempotencyKey: `k-${nativeId}`,
      task: "fix login",
      threadId: `fake:${nativeId}`,
    });
    harness.outcomes.set(nativeId, working);
    hub.start();
  }

  it("delivers a finish owed when the app died before submitting it, once, after the restart", async () => {
    const bot = await seedBot();
    await handOff(bot, "t1");
    // The first process records the finish, then dies inside the submit.
    const crash = watch(() => new Promise<void>(() => {}));
    harness.outcomes.set("t1", ended("All tests pass.", 3));
    harness.endTurn("t1");
    await eventually(async () => expect(await owedFinishes()).toHaveLength(1));
    expect(await runningHandoffs()).toHaveLength(0);
    crash();
    expect(await finishesIn(bot)).toEqual([]);

    watch();
    await eventually(async () => expect(await owedFinishes()).toHaveLength(0));
    const delivered = await finishesIn(bot);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain("All tests pass.");

    // The same turn's end again, a reconnect: nothing more arrives.
    harness.endTurn("t1");
    harness.emit({ type: "connected" });
    await settle();
    expect(await finishesIn(bot)).toHaveLength(1);
  });

  it("does not post twice when the app died after the submit but before marking it delivered", async () => {
    const bot = await seedBot();
    await handOff(bot, "t2");
    const crash = watch(async (finish) => {
      await intoChat(finish);
      throw new Error("died before marking it delivered");
    });
    harness.outcomes.set("t2", ended("Done.", 4));
    harness.endTurn("t2");
    await eventually(async () => expect(await finishesIn(bot)).toHaveLength(1));
    expect(await owedFinishes()).toHaveLength(1);
    crash();

    watch();
    await eventually(async () => expect(await owedFinishes()).toHaveLength(0));
    expect(await finishesIn(bot)).toHaveLength(1);
  });

  it("retries a failed submit until it lands", async () => {
    const bot = await seedBot();
    await handOff(bot, "t3");
    let failures = 2;
    watch(async (finish) => {
      if (failures-- > 0) throw new Error("the chat is unavailable");
      await intoChat(finish);
    }, 20);
    harness.outcomes.set("t3", ended("Done.", 5));
    harness.endTurn("t3");
    await eventually(async () => expect(await finishesIn(bot)).toHaveLength(1));
    expect(failures).toBeLessThan(0);
    await eventually(async () => expect(await owedFinishes()).toHaveLength(0));
    await settle();
    expect(await finishesIn(bot)).toHaveLength(1);
  });
});

describe("hand-off starts (C7b: one thread per tool call)", () => {
  const startInput = (bot: SeededBot, idempotencyKey: string) => ({
    conversationId: Number(bot.conversationId),
    idempotencyKey,
    task: "fix the build",
    cwd: "/repo",
    harness: "fake",
  });

  it("makes one thread when a replay arrives while the first run is still starting", async () => {
    const bot = await seedBot();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const create = harness.createThread.bind(harness);
    harness.createThread = async (input) => {
      await gate;
      return create(input);
    };
    const first = codeStore.start(startInput(bot, "start-1"));
    const replay = codeStore.start(startInput(bot, "start-1"));
    await settle(10);
    release();
    const [a, b] = await Promise.all([first, replay]);
    expect(b).toEqual(a);
    expect(ok(a).threadId).toBe("fake:t1");
    expect(await codeStore.start(startInput(bot, "start-1"))).toEqual(a);
    expect(harness.created).toHaveLength(1);
  });

  it("does not repeat a start a restart interrupted after the harness made its thread", async () => {
    const bot = await seedBot();
    // The first run claimed the start and the harness made the thread; the
    // app died before recording it.
    await claimHandoff({
      botId: bot.id,
      conversationId: bot.conversationId,
      idempotencyKey: "start-2",
      task: "fix the build",
    });
    await harness.createThread({ message: "fix the build", cwd: "/repo" });

    const replay = await codeStore.start(startInput(bot, "start-2"));
    expect(replay).toEqual({ error: expect.stringMatching(/interrupted by a restart/) });
    expect(harness.created).toHaveLength(1);
    expect(await codeStore.list(Number(bot.conversationId))).toEqual([]);
  });

  it("lets a start the harness refused run again", async () => {
    const bot = await seedBot();
    const create = harness.createThread.bind(harness);
    harness.createThread = async () => {
      throw new Error("the harness is down");
    };
    await expect(codeStore.start(startInput(bot, "start-3"))).rejects.toThrow(
      "the harness is down",
    );
    harness.createThread = create;
    expect(ok(await codeStore.start(startInput(bot, "start-3"))).threadId).toBe("fake:t1");
  });

  it("delivers the finish of a start whose turn ends before its thread is recorded", async () => {
    const bot = await seedBot();
    watch();
    hub.start();
    // A fast harness: the first turn ends, and the watcher hears it, while
    // the start is still `starting`. No reconnect follows.
    const create = harness.createThread.bind(harness);
    harness.createThread = async (input) => {
      const made = await create(input);
      harness.outcomes.set(made.nativeId, ended("Built.", 1));
      harness.endTurn(made.nativeId);
      await settle();
      return made;
    };
    ok(await codeStore.start(startInput(bot, "start-4")));
    await eventually(async () => expect(await finishesIn(bot)).toHaveLength(1));
    expect((await finishesIn(bot))[0]).toContain("Built.");
    expect(await runningHandoffs()).toEqual([]);
  });
});

describe("hand-off follow-ups (C7c: sends wait for their reopen)", () => {
  async function started(bot: SeededBot) {
    hub.start();
    const handoff = ok(
      await codeStore.start({
        conversationId: Number(bot.conversationId),
        idempotencyKey: "s1",
        task: "fix login",
        cwd: "/repo",
        harness: "fake",
      }),
    );
    return { threadId: handoff.threadId, nativeId: handoff.threadId.slice("fake:".length) };
  }

  it("delivers a follow-up whose turn ends before the send returns", async () => {
    const bot = await seedBot();
    watch();
    const { threadId, nativeId } = await started(bot);
    harness.outcomes.set(nativeId, ended("Login fixed.", 1));
    harness.endTurn(nativeId);
    await eventually(async () => expect(await finishesIn(bot)).toHaveLength(1));

    // A fast harness: the follow-up's turn ends, and the watcher hears it,
    // before the send returns.
    const send = harness.send.bind(harness);
    harness.send = async (id, input) => {
      const result = await send(id, input);
      harness.outcomes.set(id, ended("Logout fixed too.", 2));
      harness.endTurn(id);
      await settle();
      return result;
    };
    expect(
      await codeStore.send({
        conversationId: Number(bot.conversationId),
        idempotencyKey: "f1",
        threadId,
        message: "also logout",
      }),
    ).toEqual({ status: "accepted" });
    await eventually(async () => expect(await finishesIn(bot)).toHaveLength(2));
    expect((await finishesIn(bot))[1]).toContain("Logout fixed too.");
    expect(await runningHandoffs()).toHaveLength(0);
  });

  it("runs a thread's sends one at a time, in order, and undoes the reopen of a refused one", async () => {
    const bot = await seedBot();
    const { threadId } = await started(bot);
    const order: string[] = [];
    let inFlight = 0;
    let most = 0;
    harness.send = async (_id, input) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      order.push(input.message);
      await settle(10);
      inFlight -= 1;
      if (input.message === "refused") throw new Error("the harness refused it");
      return { status: "accepted" };
    };
    const send = (message: string, index: number) =>
      codeStore.send({
        conversationId: Number(bot.conversationId),
        idempotencyKey: `f${index}`,
        threadId,
        message,
      });
    const sends = ["one", "two", "three"].map(send);
    expect(await Promise.all(sends)).toEqual([
      { status: "accepted" },
      { status: "accepted" },
      { status: "accepted" },
    ]);
    expect(order).toEqual(["one", "two", "three"]);
    expect(most).toBe(1);

    // No watcher here: the turn's end is recorded by hand. A follow-up the
    // harness refuses leaves the hand-off finished, as it found it.
    const [running] = await runningHandoffs();
    expect(await finishHandoffOnce(running!.id)).toBe(true);
    await expect(send("refused", 4)).rejects.toThrow("the harness refused it");
    expect(await runningHandoffs()).toEqual([]);
  });

  it("never owes again, on a reconnect after a follow-up, a turn that ended before it", async () => {
    const bot = await seedBot();
    // A hand-off finished before the upgrade: no finish row records its turn.
    const handoff = await recordHandoff({
      botId: bot.id,
      conversationId: bot.conversationId,
      idempotencyKey: "old-1",
      task: "fix login",
      threadId: "fake:tOld",
    });
    await db
      .update(codeHandoffs)
      .set({
        status: "finished",
        createdAt: new Date(Date.now() - 60_000),
        finishedAt: new Date(Date.now() - 30_000),
      })
      .where(eq(codeHandoffs.id, handoff.id));
    harness.outcomes.set("tOld", { ...ended("Login fixed.", 1), endedAt: Date.now() - 40_000 });
    watch();
    hub.start();

    await codeStore.send({
      conversationId: Number(bot.conversationId),
      idempotencyKey: "f-old",
      threadId: "fake:tOld",
      message: "also logout",
    });
    // A reconnect before the follow-up's turn starts reads the old outcome.
    harness.emit({ type: "connected" });
    await settle();
    expect(await finishesIn(bot)).toEqual([]);
    expect(await runningHandoffs()).toHaveLength(1);

    harness.outcomes.set("tOld", ended("Logout fixed too.", 2));
    harness.endTurn("tOld");
    await eventually(async () => expect(await finishesIn(bot)).toHaveLength(1));
    expect((await finishesIn(bot))[0]).toContain("Logout fixed too.");
  });
});

describe("hand-off finishes go back to the conversation that asked", () => {
  const conversation = () => runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });

  /** A routine run's own conversation (each run starts a fresh one, issue #63). */
  async function routineRunConversation(bot: SeededBot): Promise<number> {
    const ref = await conversation();
    const [routine] = await db
      .insert(routines)
      .values({
        botId: bot.id,
        name: "nightly",
        prompt: "Fix the flaky test.",
        schedule: { kind: "interval", minutes: 60 },
      })
      .returning();
    await db.insert(routineRuns).values({
      routineId: routine!.id,
      scheduledFor: new Date(),
      status: "succeeded",
      requestId: "routine-run-1",
      conversationId: String(ref),
    });
    return ref;
  }

  async function startFrom(ref: number, key: string) {
    hub.start();
    // The thread it makes is still working when the start records it.
    harness.outcomes.set(`t${harness.created.length + 1}`, working);
    const handoff = ok(
      await codeStore.start({
        conversationId: ref,
        idempotencyKey: key,
        task: "fix the flaky test",
        cwd: "/repo",
        harness: "fake",
      }),
    );
    return handoff.threadId.slice("fake:".length);
  }

  it("delivers a routine run's hand-off into that run's conversation, not the bot's chat", async () => {
    const bot = await seedBot();
    const run = await routineRunConversation(bot);
    watch();
    const nativeId = await startFrom(run, "r1");
    harness.outcomes.set(nativeId, ended("Flaky test fixed.", 1));
    harness.endTurn(nativeId);

    await eventually(async () => expect(await finishesIn(run)).toHaveLength(1));
    expect((await finishesIn(run))[0]).toContain("Flaky test fixed.");
    expect(await finishesIn(bot)).toEqual([]);
  });

  it("answers a hand-off another bot asked for where it asked, and relays that answer back", async () => {
    const asker = await seedBot({ name: "Asker" });
    const coder = await seedBot({ name: "Coder" });
    // Asker messaged Coder from its chat; Coder answered in a conversation
    // of its own (PR 337) and handed the work off from there.
    const own = await conversation();
    await db.insert(botMessages).values({
      fromBotId: asker.id,
      toBotId: coder.id,
      conversationId: String(own),
      ownConversation: true,
      replyToBotId: asker.id,
      kind: "relay",
      requestId: "ask-1",
      text: "Please fix the flaky test.",
      deliveredAt: new Date(),
      answeredAt: new Date(),
    });
    const stopSettled = startSettledPipeline(runtime);
    stops.push(stopSettled);
    watch();
    const nativeId = await startFrom(own, "d1");
    harness.outcomes.set(nativeId, ended("Flaky test fixed.", 1));
    harness.endTurn(nativeId);

    await eventually(async () => expect(await finishesIn(own)).toHaveLength(1));
    expect(await finishesIn(coder)).toEqual([]);
    // Coder's answer to the finish reaches Asker, as its first answer did.
    const relayed = async () =>
      (await runtime.readChat(Number(asker.conversationId))).messages
        .filter((m) => m.role === "user")
        .map((m) => m.text);
    await eventually(async () =>
      expect(await relayed()).toEqual([
        expect.stringMatching(/^\*\*Reply from Coder:\*\* Echo: .*Flaky test fixed\./s),
      ]),
    );
  });

  it("sends a follow-up's finish to the conversation that sent the follow-up", async () => {
    const bot = await seedBot();
    const run = await routineRunConversation(bot);
    watch();
    const nativeId = await startFrom(run, "r2");
    harness.outcomes.set(nativeId, ended("Flaky test fixed.", 1));
    harness.endTurn(nativeId);
    await eventually(async () => expect(await finishesIn(run)).toHaveLength(1));

    // The owner, in the bot's chat, asks for more on the same thread.
    await codeStore.send({
      conversationId: Number(bot.conversationId),
      idempotencyKey: "r2-follow-up",
      threadId: `fake:${nativeId}`,
      message: "also add a regression test",
    });
    harness.outcomes.set(nativeId, ended("Regression test added.", 2));
    harness.endTurn(nativeId);

    await eventually(async () => expect(await finishesIn(bot)).toHaveLength(1));
    expect((await finishesIn(bot))[0]).toContain("Regression test added.");
    expect(await finishesIn(run)).toHaveLength(1);
  });
});
