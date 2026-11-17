/**
 * Memory capture: the prompt, the window, the parse and the debounce. What
 * lands is the ledger's (memories.ledger.test.ts) and how the model is
 * picked and called is the side-caller's (side-call.test.ts); here the
 * side-caller is one faked `complete`.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import {
  buildCapturePrompt,
  parseExtraction,
  createMemoryCapture,
} from "../../../../apps/web/src/server/api/bots/memories.capture";
import {
  captureWindow,
  captureConversation,
} from "../../../../apps/web/src/server/api/bots/memories.runner";
import { memoryStore } from "../../../../apps/web/src/server/api/bots/memories.store";
import type { SideCaller } from "../../../../apps/web/src/server/api/bots/side-call";
import type { ConversationOwner } from "../../../../apps/web/src/server/api/bots/bots.owner";
import { bots, db, memories, routines } from "../../../../apps/web/src/server/db";
import { resetAppTables, seedBot as seedBotRow } from "../../fixtures";

const conversationId = () => Math.floor(Math.random() * 1_000_000_000);
vi.mock("@groot/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await resetAppTables();
});

async function seedBot(): Promise<{ botId: string; conversationId: number }> {
  const bot = await seedBotRow({
    name: "Cap",
    modelId: "m",
    conversationId: String(conversationId()),
  });
  return { botId: bot.id, conversationId: Number(bot.conversationId) };
}

function findBot(id: string) {
  return db.query.bots.findFirst({ where: eq(bots.id, id) });
}

/** The side-caller port, faked: one `complete` answering with `reply`. */
function sideCaller(reply = "[]") {
  return { complete: vi.fn<SideCaller["complete"]>().mockResolvedValue(reply) };
}

const ownerSays = (text: string) => async () => [{ role: "user", text, createdAt: Date.now() }];

describe("buildCapturePrompt", () => {
  it("carries the anti-junk rules and JSON contract", () => {
    const prompt = buildCapturePrompt({
      botName: "Scout",
      transcript: "Owner: hi",
      currentMemories: null,
      today: "2026-10-21",
    });
    expect(prompt).toContain("CAPTURE step");
    expect(prompt).toContain("Never secrets");
    expect(prompt).toContain("supersedesIds");
    expect(prompt).toContain("third person");
    expect(prompt).toContain("Today is 2026-10-21");
    expect(prompt).toContain("even if reworded");
  });

  it("lists what the owner removed as never-re-add, and nothing when there is none", () => {
    const input = {
      botName: "Scout",
      transcript: "Owner: hi",
      currentMemories: null,
      today: "2026-10-29",
    };
    const prompt = buildCapturePrompt({
      ...input,
      removedMemories: "- The owner prefers tea.",
    });
    expect(prompt).toContain(
      "The owner removed these memories. Never add them again, reworded or not:",
    );
    expect(prompt).toContain("- The owner prefers tea.");
    expect(buildCapturePrompt(input)).not.toContain("removed these memories");
  });
});

describe("parseExtraction", () => {
  it("parses a JSON array out of the reply text", () => {
    const parsed = parseExtraction(
      'Here: [{"text":"Likes tea","category":"preference","confidence":0.9}]',
    );
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.text).toBe("Likes tea");
  });

  it("returns null for malformed output so the watermark stays put", () => {
    expect(parseExtraction("not json")).toBeNull();
    expect(parseExtraction('[{"text":"x","category":"vibe","confidence":0.5}]')).toBeNull();
  });

  it("returns null for a model that says nothing", () => {
    expect(parseExtraction(undefined)).toBeNull();
    expect(parseExtraction("")).toBeNull();
  });
});

describe("captureWindow", () => {
  const msgs = [
    { role: "user", text: "old turn", createdAt: 1, peer: undefined },
    {
      role: "user",
      text: "peer delivery",
      createdAt: 5,
      peer: { kind: "reply", name: "Bot" },
    },
    { role: "assistant", text: "reply", createdAt: 6 },
    { role: "user", text: "I prefer pnpm", createdAt: 10 },
  ];

  it("counts only owner-authored user turns after the watermark", () => {
    const w = captureWindow(msgs, new Date(2), "Scout");
    expect(w.turns).toBe(1);
    expect(w.lines).toEqual(["Owner: I prefer pnpm"]);
    expect(w.through?.getTime()).toBe(10);
  });

  it("returns no watermark when nothing qualifies", () => {
    expect(captureWindow([], null, "Scout").through).toBeNull();
  });

  it("includes assistant context but excludes peers and their replies", () => {
    const messages = [
      { role: "user", text: "Let's get acquainted.", createdAt: 1 },
      { role: "assistant", text: "Where do you live?", createdAt: 3 },
      { role: "user", text: "In Chennai, near my office.", createdAt: 4 },
      { role: "assistant", text: "Got it.", createdAt: 5 },
      {
        role: "user",
        text: "Peer's request",
        createdAt: 6,
        peer: { kind: "request" },
      },
      { role: "assistant", text: "Peer's answer", createdAt: 7 },
    ];
    const window = captureWindow(messages, new Date(1), "Scout");
    expect(window.lines).toEqual([
      "Scout: Where do you live?",
      "Owner: In Chennai, near my office.",
      "Scout: Got it.",
    ]);
    expect(window.turns).toBe(1);
    expect(window.through?.getTime()).toBe(4);
    expect(window.ownerBytes).toBe(Buffer.byteLength("In Chennai, near my office."));
  });

  it("clips assistant replies and ignores errors without inflating owner bytes", () => {
    const window = captureWindow(
      [
        { role: "user", text: "你好", createdAt: 1 },
        { role: "assistant", text: "x".repeat(3_000), createdAt: 2 },
        {
          role: "assistant",
          text: "model error",
          createdAt: 3,
          status: "error",
        },
      ],
      null,
      "Scout",
    );
    expect(window.ownerBytes).toBe(6);
    // Replies are only context for the owner's words: the first 500 characters.
    expect(window.lines).toEqual(["Owner: 你好", `Scout: ${"x".repeat(500)}`]);
  });

  it("caps a long window to its newest lines but still ends at the newest owner turn", () => {
    // A never-captured bot (null watermark) with ~100k chars of history.
    const messages = Array.from({ length: 200 }, (_, i) => ({
      role: "user",
      text: `Turn ${String(i).padStart(3, "0")} ${"y".repeat(500)}`,
      createdAt: i + 1,
    }));
    const window = captureWindow(messages, null, "Scout");
    const size = window.lines.reduce((sum, line) => sum + line.length + 1, 0);
    expect(size).toBeLessThanOrEqual(24_000);
    expect(window.lines.at(-1)).toContain("Turn 199");
    expect(window.lines.join("\n")).not.toContain("Turn 000");
    expect(window.turns).toBe(window.lines.length);
    expect(window.through?.getTime()).toBe(200);
  });
});

describe("captureConversation", () => {
  it("asks the side-caller on the bot's model and lands what it extracts", async () => {
    const { botId, conversationId } = await seedBot();
    const caller = sideCaller(
      '[{"text":"The owner prefers TypeScript, never JavaScript.","category":"preference","confidence":0.9}]',
    );
    const messages = [
      {
        role: "user",
        text: "I prefer TypeScript, never JavaScript",
        createdAt: Date.now(),
      },
    ];
    await captureConversation(conversationId, {
      sideCaller: caller,
      readTranscript: async () => messages,
    });
    expect(caller.complete).toHaveBeenCalledOnce();
    expect(caller.complete.mock.calls[0]![0]).toMatchObject({
      role: "memory_capture",
      botModelId: "m",
      user: "Extract now.",
      label: "Memory capture",
      system: expect.stringContaining("Owner: I prefer TypeScript, never JavaScript"),
    });
    expect(await db.query.memories.findFirst({ where: eq(memories.botId, botId) })).toMatchObject({
      text: "The owner prefers TypeScript, never JavaScript.",
      source: "capture",
      status: "active",
    });
    expect((await findBot(botId))?.memoryCapturedThrough?.getTime()).toBe(messages[0]!.createdAt);
  });

  it("shows the extractor short memory refs, not row ids, and maps a supersede back", async () => {
    const { botId, conversationId } = await seedBot();
    const [old] = await db
      .insert(memories)
      .values([
        {
          botId,
          text: "The owner lives in Pune.",
          category: "fact",
          createdAt: new Date(1_000),
        },
        {
          botId,
          text: "The owner likes tea.",
          category: "preference",
          createdAt: new Date(2_000),
        },
      ])
      .returning();
    const caller = sideCaller(
      '[{"text":"The owner lives in Berlin.","category":"fact","confidence":0.9,"supersedesIds":["m1"]}]',
    );
    await captureConversation(conversationId, {
      sideCaller: caller,
      readTranscript: ownerSays("I moved from Pune to Berlin last week."),
    });
    const prompt = caller.complete.mock.calls[0]![0].system;
    expect(prompt).toContain("- m1 — The owner lives in Pune.\n- m2 — The owner likes tea.");
    expect(prompt).not.toContain(old!.id);
    expect(await db.query.memories.findFirst({ where: eq(memories.id, old!.id) })).toMatchObject({
      status: "superseded",
    });
    const berlin = await db.query.memories.findFirst({
      where: and(
        eq(memories.botId, botId),
        eq(memories.status, "active"),
        eq(memories.category, "fact"),
      ),
    });
    expect(berlin).toMatchObject({ text: "The owner lives in Berlin." });
    expect(old).toMatchObject({ text: "The owner lives in Pune." });
  });

  it("marks what it captured as learned in that conversation", async () => {
    const { conversationId } = await seedBot();
    await captureConversation(conversationId, {
      sideCaller: sideCaller(
        '[{"text":"The owner prefers TypeScript.","category":"preference","confidence":0.9}]',
      ),
      readTranscript: ownerSays("I prefer TypeScript for everything."),
    });
    expect(await memoryStore.list(conversationId)).toMatchObject([
      { text: "The owner prefers TypeScript.", learnedHere: true },
    ]);
  });

  it("makes no call without a side-caller (faux mode) or with memory off", async () => {
    const { botId, conversationId } = await seedBot();
    const readTranscript = vi.fn(ownerSays("x".repeat(300)));
    await captureConversation(conversationId, {
      sideCaller: undefined,
      readTranscript,
    });
    expect(readTranscript).not.toHaveBeenCalled();

    await db.update(bots).set({ memoryEnabled: false }).where(eq(bots.id, botId));
    const caller = sideCaller();
    await captureConversation(conversationId, {
      sideCaller: caller,
      readTranscript,
    });
    expect(caller.complete).not.toHaveBeenCalled();
    expect((await findBot(botId))?.memoryCapturedThrough).toBeNull();
  });

  it("advances the watermark without a call for a trivial window", async () => {
    const { botId, conversationId } = await seedBot();
    const caller = sideCaller();
    await captureConversation(conversationId, {
      sideCaller: caller,
      readTranscript: ownerSays("hi"),
    });
    expect(caller.complete).not.toHaveBeenCalled();
    expect((await findBot(botId))?.memoryCapturedThrough).not.toBeNull();
  });

  it("retries the unchanged window after no answer or an unparseable one", async () => {
    const { botId, conversationId } = await seedBot();
    const messages = [
      {
        role: "user",
        text: "I prefer TypeScript, never JavaScript",
        createdAt: Date.now(),
      },
    ];
    const caller = sideCaller();
    caller.complete.mockResolvedValue(undefined);
    const deps = { sideCaller: caller, readTranscript: async () => messages };
    await captureConversation(conversationId, deps);
    expect((await findBot(botId))?.memoryCapturedThrough).toBeNull();
    caller.complete.mockResolvedValue("not json");
    await captureConversation(conversationId, deps);
    expect((await findBot(botId))?.memoryCapturedThrough).toBeNull();
    caller.complete.mockResolvedValue("[]");
    await captureConversation(conversationId, deps);
    expect(caller.complete).toHaveBeenCalledTimes(3);
    expect((await findBot(botId))?.memoryCapturedThrough?.getTime()).toBe(messages[0]!.createdAt);
  });

  it("skips peer-only windows", async () => {
    const { botId, conversationId } = await seedBot();
    const caller = sideCaller();
    await captureConversation(conversationId, {
      sideCaller: caller,
      readTranscript: async () => [
        {
          role: "user",
          text: "Peer ".repeat(60),
          peer: { kind: "request" },
          createdAt: 1,
        },
        { role: "assistant", text: "Peer reply", createdAt: 2 },
      ],
    });
    expect(caller.complete).not.toHaveBeenCalled();
    expect(await db.$count(memories, eq(memories.botId, botId))).toBe(0);
    expect((await findBot(botId))?.memoryCapturedThrough).toBeNull();
  });

  it("never captures a routine's conversation (issue #63): only the chat is a source", async () => {
    const { botId } = await seedBot();
    const routineConversation = conversationId();
    await db.insert(routines).values({
      botId,
      name: "Daily",
      prompt: "News",
      schedule: { kind: "interval", minutes: 60 },
      conversationId: String(routineConversation),
    });
    const caller = sideCaller();
    const readTranscript = vi.fn(ownerSays("I prefer TypeScript, never JavaScript"));
    await captureConversation(routineConversation, {
      sideCaller: caller,
      readTranscript,
    });
    expect(readTranscript).not.toHaveBeenCalled();
    expect(caller.complete).not.toHaveBeenCalled();
    expect(await db.$count(memories, eq(memories.botId, botId))).toBe(0);
    expect((await findBot(botId))?.memoryCapturedThrough).toBeNull();
  });

  it("shows the newest 30 deleted memories to the extractor, which then leaves them out", async () => {
    const { botId, conversationId } = await seedBot();
    await db.insert(memories).values(
      Array.from({ length: 35 }, (_, i) => ({
        botId,
        text: `Removed fact ${String(i).padStart(2, "0")}.`,
        category: "fact",
        status: "deleted" as const,
        updatedAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
      })),
    );
    await db.insert(memories).values({
      botId,
      text: "Owner prefers tea",
      category: "preference",
      status: "deleted",
      updatedAt: new Date(Date.UTC(2026, 9, 2)),
    });
    // A scripted extractor that, like a model following the prompt, drops a
    // reworded fact the prompt lists as removed.
    const caller = sideCaller();
    caller.complete.mockImplementation(async ({ system }) =>
      JSON.stringify(
        [
          {
            text: "The owner likes tea.",
            category: "preference",
            confidence: 0.9,
          },
          {
            text: "The owner lives in Chennai.",
            category: "fact",
            confidence: 0.9,
          },
        ].filter((m) => !(m.text.includes("tea") && system.includes("Owner prefers tea"))),
      ),
    );
    await captureConversation(conversationId, {
      sideCaller: caller,
      readTranscript: ownerSays("I like tea and I live in Chennai."),
    });
    const prompt = caller.complete.mock.calls[0]![0].system;
    expect(prompt).toContain("- Owner prefers tea");
    expect(prompt).toContain("Removed fact 34.");
    expect(prompt).toContain("Removed fact 06.");
    expect(prompt).not.toContain("Removed fact 05.");
    const active = await db.query.memories.findMany({
      where: and(eq(memories.botId, botId), eq(memories.status, "active")),
    });
    expect(active.map((m) => m.text)).toEqual(["The owner lives in Chennai."]);
  });
});

const settledChat = async () => ({ messages: [], busy: false, queued: [] });

/** A settled conversation of a bot's own chat, memory on unless said otherwise. */
const settled = (conversationId: number, owner?: ConversationOwner) => ({
  conversationId,
  chat: settledChat,
  owner: async () =>
    owner ??
    ({
      kind: "chat",
      bot: {
        id: "b",
        name: "B",
        modelId: "m",
        browserProfile: "shared",
        memoryEnabled: true,
        shared: false,
      },
    } satisfies ConversationOwner),
});

describe("memory capture debounce (a settled step)", () => {
  it("fires on the quiet window and pushes back on new turns", async () => {
    vi.useFakeTimers();
    const captureNow = vi.fn().mockResolvedValue(undefined);
    const capture = createMemoryCapture({
      captureNow,
      quietMs: 100,
      turnLimit: 6,
    });
    await capture.onSettled.run(settled(7)); // turn 1
    vi.advanceTimersByTime(50);
    await capture.onSettled.run(settled(7)); // turn 2 pushes the window back
    vi.advanceTimersByTime(60);
    expect(captureNow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(captureNow).toHaveBeenCalledWith(7);
    capture.stop();
  });

  it("arms only for a bot's own chat with memory on", async () => {
    vi.useFakeTimers();
    const captureNow = vi.fn().mockResolvedValue(undefined);
    const capture = createMemoryCapture({
      captureNow,
      quietMs: 100,
      turnLimit: 6,
    });
    const bot = {
      id: "b",
      name: "B",
      modelId: "m",
      browserProfile: "shared",
      memoryEnabled: true,
      shared: false,
    };
    await capture.onSettled.run(settled(1, { kind: "routine", bot, routineId: "r" }));
    await capture.onSettled.run(
      settled(2, { kind: "chat", bot: { ...bot, memoryEnabled: false } }),
    );
    await capture.onSettled.run({
      ...settled(3),
      owner: async () => undefined,
    });
    vi.advanceTimersByTime(500);
    expect(captureNow).not.toHaveBeenCalled();
    capture.stop();
  });

  it("does not run a second capture while one is inflight", async () => {
    vi.useFakeTimers();
    const gates: Array<() => void> = [];
    const captureNow = vi.fn(() => new Promise<void>((resolve) => gates.push(resolve)));
    const capture = createMemoryCapture({
      captureNow,
      quietMs: 100_000,
      turnLimit: 3,
    });
    const emit = (times: number) =>
      Array.from({ length: times }).reduce<Promise<unknown>>(
        (previous) => previous.then(() => capture.onSettled.run(settled(9))),
        Promise.resolve(),
      );
    await emit(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(captureNow).toHaveBeenCalledTimes(1);
    await emit(4);
    await vi.advanceTimersByTimeAsync(0);
    expect(captureNow).toHaveBeenCalledTimes(1); // still inflight
    gates[0]!();
    await vi.advanceTimersByTimeAsync(0);
    await emit(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(captureNow).toHaveBeenCalledTimes(2);
    capture.stop();
  });

  it("re-arms the quiet window for turns that settled during a capture", async () => {
    vi.useFakeTimers();
    const gates: Array<() => void> = [];
    const captureNow = vi.fn(() => new Promise<void>((resolve) => gates.push(resolve)));
    const capture = createMemoryCapture({
      captureNow,
      quietMs: 100,
      turnLimit: 10,
    });
    await capture.onSettled.run(settled(11));
    await vi.advanceTimersByTimeAsync(100);
    expect(captureNow).toHaveBeenCalledTimes(1);
    await capture.onSettled.run(settled(11)); // settles while the capture runs: not lost
    gates[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(captureNow).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(captureNow).toHaveBeenCalledTimes(2);
    capture.stop();
  });

  it("forces a capture at the turn limit", async () => {
    vi.useFakeTimers();
    const captureNow = vi.fn().mockResolvedValue(undefined);
    const capture = createMemoryCapture({
      captureNow,
      quietMs: 100_000,
      turnLimit: 3,
    });
    await capture.onSettled.run(settled(9));
    await capture.onSettled.run(settled(9));
    expect(captureNow).not.toHaveBeenCalled();
    await capture.onSettled.run(settled(9));
    expect(captureNow).toHaveBeenCalledWith(9);
    capture.stop();
  });
});
