import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText } from "../../../../packages/agent/src/testing";
import {
  buildCapturePrompt,
  parseExtraction,
  applyExtraction,
  createMemoryCapture,
  type CaptureModels,
} from "../../../../apps/web/src/server/api/bots/memories.capture";
import {
  captureWindow,
  captureConversation,
  resolveCaptureModelId,
} from "../../../../apps/web/src/server/api/bots/memories.runner";
import { bots, db, memories, routines } from "../../../../apps/web/src/server/db";

const conversationId = () => Math.floor(Math.random() * 1_000_000_000);
vi.mock("@groot/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
const botIds: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.delete(bots).where(inArray(bots.id, botIds.splice(0)));
});

async function seedBot(): Promise<{ botId: string; conversationId: number }> {
  const conv = conversationId();
  const [bot] = await db
    .insert(bots)
    .values({ name: "Cap", modelId: "m", conversationId: String(conv) })
    .returning();
  botIds.push(bot!.id);
  return { botId: bot!.id, conversationId: conv };
}

function findBot(id: string) {
  return db.query.bots.findFirst({ where: eq(bots.id, id) });
}

function sideCall(reply = fauxAssistantMessage([fauxText("[]")])) {
  const getModel = vi.fn((_provider: string, id: string) => ({ id }) as Model<Api>);
  const completeSimple = vi.fn<CaptureModels["completeSimple"]>().mockResolvedValue(reply);
  return {
    models: { getModel, completeSimple },
    hasModel: vi.fn((id: string) => id === "m" || id === "custom:test/chat"),
  };
}

describe("buildCapturePrompt removed memories", () => {
  it("lists what the owner removed as never-re-add, and nothing when there is none", () => {
    const input = {
      botName: "Scout",
      transcript: "Owner: hi",
      currentMemories: null,
      today: "2026-10-29",
    };
    const prompt = buildCapturePrompt({ ...input, removedMemories: "- The owner prefers tea." });
    expect(prompt).toContain(
      "The owner removed these memories. Never add them again, reworded or not:",
    );
    expect(prompt).toContain("- The owner prefers tea.");
    expect(buildCapturePrompt(input)).not.toContain("removed these memories");
  });
});

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
});

describe("parseExtraction", () => {
  it("parses a JSON array from a text reply", () => {
    const reply = {
      content: [
        { type: "text", text: '[{"text":"Likes tea","category":"preference","confidence":0.9}]' },
      ],
    };
    const parsed = parseExtraction(reply);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe("Likes tea");
  });

  it("returns null for malformed output so the watermark stays put", () => {
    expect(parseExtraction({ content: [{ type: "text", text: "not json" }] })).toBeNull();
    expect(
      parseExtraction({
        content: [{ type: "text", text: '[{"text":"x","category":"vibe","confidence":0.5}]' }],
      }),
    ).toBeNull();
  });

  it("returns null for a model that says nothing", () => {
    expect(parseExtraction(undefined)).toBeNull();
  });
});

describe("applyExtraction", () => {
  it("creates rows and advances the watermark in the same transaction", async () => {
    const { botId } = await seedBot();
    const through = new Date();
    const result = await applyExtraction(
      botId,
      [{ text: "Prefers pnpm", category: "preference", confidence: 0.9 }],
      through,
    );
    expect(result).toEqual({ created: 1, superseded: 0, skipped: 0 });
    const bot = await findBot(botId);
    expect(bot?.memoryCapturedThrough?.toISOString()).toBe(through.toISOString());
  });

  it("skips exact-text duplicates, including tombstones (never re-add)", async () => {
    const { botId } = await seedBot();
    await applyExtraction(
      botId,
      [{ text: "Prefers pnpm", category: "preference", confidence: 0.9 }],
      new Date(),
    );
    const again = await applyExtraction(
      botId,
      [{ text: "prefers pnpm", category: "preference", confidence: 0.95 }],
      new Date(),
    );
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(1);

    const row = await db.query.memories.findFirst({ where: eq(memories.botId, botId) });
    await db.update(memories).set({ status: "deleted" }).where(eq(memories.id, row!.id));
    const afterTombstone = await applyExtraction(
      botId,
      [{ text: "Prefers pnpm", category: "preference", confidence: 0.9 }],
      new Date(),
    );
    expect(afterTombstone.created).toBe(0);
  });

  it("supersedes only rows of the same bot", async () => {
    const { botId: botA } = await seedBot();
    const { botId: botB } = await seedBot();
    const first = await applyExtraction(
      botA,
      [{ text: "Lives in Bangalore", category: "fact", confidence: 0.8 }],
      new Date(),
    );
    const rowA = await db.query.memories.findFirst({ where: eq(memories.botId, botA) });
    const [rowB] = await db
      .insert(memories)
      .values({
        botId: botB,
        text: "Other bot fact",
        category: "fact",
        status: "active",
        source: "manual",
      })
      .returning();
    expect(first.created).toBe(1);

    const result = await applyExtraction(
      botA,
      [
        {
          text: "Lives in Chennai now",
          category: "fact",
          confidence: 0.9,
          supersedesIds: [rowA!.id, rowB!.id],
        },
      ],
      new Date(),
    );
    expect(result.superseded).toBe(1);
    const supersededRow = await db.query.memories.findFirst({ where: eq(memories.id, rowA!.id) });
    expect(supersededRow?.status).toBe("superseded");
    expect(supersededRow?.supersededById).toBeTruthy();
    const untouched = await db.query.memories.findFirst({ where: eq(memories.id, rowB!.id) });
    expect(untouched?.status).toBe("active");
  });

  it("archives the oldest active rows past the budget", async () => {
    const { botId } = await seedBot();
    const extraction = Array.from({ length: 105 }, (_, i) => ({
      text: `Fact ${i}`,
      category: "fact" as const,
      confidence: 0.9,
    }));
    await applyExtraction(botId, extraction, new Date());
    const active = await db.$count(
      memories,
      and(eq(memories.botId, botId), eq(memories.status, "active")),
    );
    const archived = await db.$count(
      memories,
      and(eq(memories.botId, botId), eq(memories.status, "archived")),
    );
    expect(active).toBe(100);
    expect(archived).toBe(5);
    const oldest = await db.query.memories.findFirst({
      where: and(eq(memories.botId, botId), eq(memories.status, "archived")),
    });
    expect(oldest?.text).toBe("Fact 0");
  });
});

describe("captureWindow", () => {
  const msgs = [
    { role: "user", text: "old turn", createdAt: 1, peer: undefined },
    { role: "user", text: "peer delivery", createdAt: 5, peer: { kind: "reply", name: "Bot" } },
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
      { role: "user", text: "Peer's request", createdAt: 6, peer: { kind: "request" } },
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
        { role: "assistant", text: "model error", createdAt: 3, status: "error" },
      ],
      null,
      "Scout",
    );
    expect(window.ownerBytes).toBe(6);
    expect(window.lines).toEqual(["Owner: 你好", `Scout: ${"x".repeat(1_500)}`]);
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

describe("resolveCaptureModelId", () => {
  it("uses the bot's model instead of a hardcoded gateway model", () => {
    expect(resolveCaptureModelId(sideCall(), "m")).toBe("m");
    expect(resolveCaptureModelId(sideCall(), "custom:test/chat")).toBe("custom:test/chat");
  });

  it("honors known overrides and falls back for unknown overrides", () => {
    expect(resolveCaptureModelId(sideCall(), "m", '"custom:test/chat"')).toBe("custom:test/chat");
    expect(resolveCaptureModelId(sideCall(), "m", "unknown")).toBe("m");
    expect(resolveCaptureModelId(sideCall(), "missing")).toBeUndefined();
  });
});

describe("captureConversation skip rules", () => {
  it("captures a short durable preference instead of discarding it", async () => {
    const { botId, conversationId } = await seedBot();
    const call = sideCall(
      fauxAssistantMessage([
        fauxText(
          '[{"text":"The owner prefers TypeScript, never JavaScript.","category":"preference","confidence":0.9}]',
        ),
      ]),
    );
    await captureConversation(conversationId, {
      sideCall: call,
      readTranscript: async () => [
        { role: "user", text: "I prefer TypeScript, never JavaScript", createdAt: Date.now() },
      ],
    });
    expect(call.models.completeSimple).toHaveBeenCalledOnce();
    expect(call.models.getModel).toHaveBeenCalledWith("cloudflare-ai-gateway", "m");
    expect(await db.query.memories.findFirst({ where: eq(memories.botId, botId) })).toMatchObject({
      text: "The owner prefers TypeScript, never JavaScript.",
      source: "capture",
      status: "active",
    });
  });

  it("makes no model call when memory is disabled", async () => {
    const { botId, conversationId } = await seedBot();
    await db.update(bots).set({ memoryEnabled: false }).where(eq(bots.id, botId));
    const call = sideCall();
    await captureConversation(conversationId, {
      sideCall: call,
      readTranscript: async () => [{ role: "user", text: "x".repeat(300), createdAt: Date.now() }],
    });
    expect(call.models.completeSimple).not.toHaveBeenCalled();
    const bot = await findBot(botId);
    expect(bot?.memoryCapturedThrough).toBeNull();
  });

  it("advances the watermark without a call for a trivial window", async () => {
    const { conversationId } = await seedBot();
    const call = sideCall();
    await captureConversation(conversationId, {
      sideCall: call,
      readTranscript: async () => [{ role: "user", text: "hi", createdAt: Date.now() }],
    });
    expect(call.models.completeSimple).not.toHaveBeenCalled();
    const bot = await db.query.bots.findFirst({
      where: eq(bots.conversationId, String(conversationId)),
    });
    expect(bot?.memoryCapturedThrough).not.toBeNull();
  });

  it("resolves a custom bot model even with an invalid capture override", async () => {
    const { botId, conversationId } = await seedBot();
    await db.update(bots).set({ modelId: "custom:test/chat" }).where(eq(bots.id, botId));
    const call = sideCall();
    await captureConversation(conversationId, {
      sideCall: { ...call, modelId: "unknown" },
      readTranscript: async () => [
        { role: "user", text: "I prefer TypeScript, never JavaScript", createdAt: Date.now() },
      ],
    });
    expect(call.models.getModel).toHaveBeenCalledWith("test", "chat");
    expect(call.models.completeSimple).toHaveBeenCalledOnce();
  });

  it("logs returned model errors and retries the unchanged window later", async () => {
    const { botId, conversationId } = await seedBot();
    const call = sideCall({
      ...fauxAssistantMessage([fauxText("[]")]),
      stopReason: "error",
      errorMessage: "Provider unavailable",
    });
    const messages = [
      { role: "user", text: "I prefer TypeScript, never JavaScript", createdAt: Date.now() },
    ];
    const deps = { sideCall: call, readTranscript: async () => messages };
    await captureConversation(conversationId, deps);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: "Provider unavailable", modelId: "m" }),
      expect.stringContaining("model failed"),
    );
    expect((await findBot(botId))?.memoryCapturedThrough).toBeNull();
    call.models.completeSimple.mockResolvedValue(fauxAssistantMessage([fauxText("[]")]));
    await captureConversation(conversationId, deps);
    expect(call.models.completeSimple).toHaveBeenCalledTimes(2);
    expect((await findBot(botId))?.memoryCapturedThrough?.getTime()).toBe(messages[0].createdAt);
  });

  it("leaves malformed extractions uncommitted and skips peer-only windows", async () => {
    const { botId, conversationId } = await seedBot();
    const call = sideCall(fauxAssistantMessage([fauxText("not json")]));
    await captureConversation(conversationId, {
      sideCall: call,
      readTranscript: async () => [
        { role: "user", text: "I prefer TypeScript, never JavaScript", createdAt: Date.now() },
      ],
    });
    expect((await findBot(botId))?.memoryCapturedThrough).toBeNull();
    call.models.completeSimple.mockClear();
    await captureConversation(conversationId, {
      sideCall: call,
      readTranscript: async () => [
        { role: "user", text: "Peer ".repeat(60), peer: { kind: "request" }, createdAt: 1 },
        { role: "assistant", text: "Peer reply", createdAt: 2 },
      ],
    });
    expect(call.models.completeSimple).not.toHaveBeenCalled();
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
    const call = sideCall();
    const readTranscript = vi.fn(async () => [
      { role: "user", text: "I prefer TypeScript, never JavaScript", createdAt: Date.now() },
    ]);
    await captureConversation(routineConversation, { sideCall: call, readTranscript });
    expect(readTranscript).not.toHaveBeenCalled();
    expect(call.models.completeSimple).not.toHaveBeenCalled();
  });
});

const settledChat = async () => ({ messages: [], busy: false, queued: [] });

describe("memory capture debounce (a settled step)", () => {
  it("fires on the quiet window and pushes back on new turns", async () => {
    vi.useFakeTimers();
    const captureNow = vi.fn().mockResolvedValue(undefined);
    const capture = createMemoryCapture({ captureNow, quietMs: 100, turnLimit: 6 });
    const emit = (_busy: boolean) =>
      void capture.onSettled.run({ conversationId: 7, chat: settledChat });
    emit(false); // turn 1
    vi.advanceTimersByTime(50);
    emit(false); // turn 2 pushes the window back
    vi.advanceTimersByTime(60);
    expect(captureNow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(captureNow).toHaveBeenCalledWith(7);
    capture.stop();
    vi.useRealTimers();
  });

  it("does not run a second capture while one is inflight", async () => {
    vi.useFakeTimers();
    const gates: Array<() => void> = [];
    const captureNow = vi.fn(() => new Promise<void>((resolve) => gates.push(resolve)));
    const capture = createMemoryCapture({ captureNow, quietMs: 100_000, turnLimit: 3 });
    const emit = () => void capture.onSettled.run({ conversationId: 9, chat: settledChat });
    emit();
    emit();
    emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(captureNow).toHaveBeenCalledTimes(1);
    emit();
    emit();
    emit();
    emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(captureNow).toHaveBeenCalledTimes(1); // still inflight
    gates[0]!();
    await vi.advanceTimersByTimeAsync(0);
    emit();
    emit();
    emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(captureNow).toHaveBeenCalledTimes(2);
    capture.stop();
    vi.useRealTimers();
  });

  it("re-arms the quiet window for turns that settled during a capture", async () => {
    vi.useFakeTimers();
    const gates: Array<() => void> = [];
    const captureNow = vi.fn(() => new Promise<void>((resolve) => gates.push(resolve)));
    const capture = createMemoryCapture({ captureNow, quietMs: 100, turnLimit: 10 });
    const emit = () => void capture.onSettled.run({ conversationId: 11, chat: settledChat });
    emit();
    await vi.advanceTimersByTimeAsync(100);
    expect(captureNow).toHaveBeenCalledTimes(1);
    emit(); // settles while the capture runs: not lost
    gates[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(captureNow).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(captureNow).toHaveBeenCalledTimes(2);
    capture.stop();
    vi.useRealTimers();
  });

  it("forces a capture at the turn limit", async () => {
    vi.useFakeTimers();
    const captureNow = vi.fn().mockResolvedValue(undefined);
    const capture = createMemoryCapture({ captureNow, quietMs: 100_000, turnLimit: 3 });
    const emit = () => void capture.onSettled.run({ conversationId: 9, chat: settledChat });
    emit();
    emit();
    expect(captureNow).not.toHaveBeenCalled();
    emit();
    expect(captureNow).toHaveBeenCalledWith(9);
    capture.stop();
    vi.useRealTimers();
  });
});

describe("captureConversation and removed memories", () => {
  it("shows the newest 30 deleted memories to the extractor, which then leaves them out", async () => {
    const { botId, conversationId } = await seedBot();
    await db.insert(memories).values(
      Array.from({ length: 35 }, (_, i) => ({
        botId,
        text: `Removed fact ${String(i).padStart(2, "0")}.`,
        category: "fact",
        status: "deleted",
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
    const call = sideCall();
    call.models.completeSimple.mockImplementation(async (_model, context) => {
      const proposed = [
        { text: "The owner likes tea.", category: "preference", confidence: 0.9 },
        { text: "The owner lives in Chennai.", category: "fact", confidence: 0.9 },
      ].filter(
        (m) => !(m.text.includes("tea") && context.systemPrompt?.includes("Owner prefers tea")),
      );
      return fauxAssistantMessage([fauxText(JSON.stringify(proposed))]);
    });
    await captureConversation(conversationId, {
      sideCall: call,
      readTranscript: async () => [
        { role: "user", text: "I like tea and I live in Chennai.", createdAt: Date.now() },
      ],
    });
    const prompt = call.models.completeSimple.mock.calls[0][1].systemPrompt ?? "";
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
