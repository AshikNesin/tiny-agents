import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { logger } from "@groot/core/logger";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText } from "../../../../packages/agent/src/testing";
import {
  buildCapturePrompt,
  parseExtraction,
  applyExtraction,
  startMemoryCapture,
  type CaptureModels,
} from "../../../../apps/web/src/server/api/bots/memories.capture";
import {
  captureWindow,
  captureConversation,
  resolveCaptureModelId,
} from "../../../../apps/web/src/server/api/bots/memories.runner";
import { composeRoutinePrompt } from "../../../../apps/web/src/server/api/routines/routines.schedule";

const conversationId = () => Math.floor(Math.random() * 1_000_000_000);
vi.mock("@groot/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
const botIds: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await prisma.bot.deleteMany({ where: { id: { in: botIds.splice(0) } } });
});

async function seedBot(): Promise<{ botId: string; conversationId: number }> {
  const conv = conversationId();
  const bot = await prisma.bot.create({
    data: { name: "Cap", modelId: "m", conversationId: String(conv) },
  });
  botIds.push(bot.id);
  return { botId: bot.id, conversationId: conv };
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
    const bot = await prisma.bot.findUnique({ where: { id: botId } });
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

    const row = await prisma.memory.findFirst({ where: { botId } });
    await prisma.memory.update({ where: { id: row!.id }, data: { status: "deleted" } });
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
    const rowA = await prisma.memory.findFirst({ where: { botId: botA } });
    const rowB = await prisma.memory.create({
      data: {
        botId: botB,
        text: "Other bot fact",
        category: "fact",
        status: "active",
        source: "manual",
      },
    });
    expect(first.created).toBe(1);

    const result = await applyExtraction(
      botA,
      [
        {
          text: "Lives in Chennai now",
          category: "fact",
          confidence: 0.9,
          supersedesIds: [rowA!.id, rowB.id],
        },
      ],
      new Date(),
    );
    expect(result.superseded).toBe(1);
    const supersededRow = await prisma.memory.findUnique({ where: { id: rowA!.id } });
    expect(supersededRow?.status).toBe("superseded");
    expect(supersededRow?.supersededById).toBeTruthy();
    const untouched = await prisma.memory.findUnique({ where: { id: rowB.id } });
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
    const active = await prisma.memory.count({ where: { botId, status: "active" } });
    const archived = await prisma.memory.count({ where: { botId, status: "archived" } });
    expect(active).toBe(100);
    expect(archived).toBe(5);
    const oldest = await prisma.memory.findFirst({ where: { botId, status: "archived" } });
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

  it("includes assistant context but excludes peers, routines, and their replies", () => {
    const messages = [
      { role: "user", text: "Let's get acquainted.", createdAt: 1 },
      { role: "assistant", text: "Where do you live?", createdAt: 3 },
      { role: "user", text: "In Chennai, near my office.", createdAt: 4 },
      { role: "assistant", text: "Got it.", createdAt: 5 },
      { role: "user", text: "Peer's request", createdAt: 6, peer: { kind: "request" } },
      { role: "assistant", text: "Peer's answer", createdAt: 7 },
      {
        role: "user",
        text: composeRoutinePrompt("Daily", "Read the news", new Date()),
        createdAt: 8,
      },
      { role: "assistant", text: "Routine answer", createdAt: 9 },
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
    expect(await prisma.memory.findFirst({ where: { botId } })).toMatchObject({
      text: "The owner prefers TypeScript, never JavaScript.",
      source: "capture",
      status: "active",
    });
  });

  it("makes no model call when memory is disabled", async () => {
    const { botId, conversationId } = await seedBot();
    await prisma.bot.update({ where: { id: botId }, data: { memoryEnabled: false } });
    const call = sideCall();
    await captureConversation(conversationId, {
      sideCall: call,
      readTranscript: async () => [{ role: "user", text: "x".repeat(300), createdAt: Date.now() }],
    });
    expect(call.models.completeSimple).not.toHaveBeenCalled();
    const bot = await prisma.bot.findUnique({ where: { id: botId } });
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
    const bot = await prisma.bot.findUnique({ where: { conversationId: String(conversationId) } });
    expect(bot?.memoryCapturedThrough).not.toBeNull();
  });

  it("resolves a custom bot model even with an invalid capture override", async () => {
    const { botId, conversationId } = await seedBot();
    await prisma.bot.update({ where: { id: botId }, data: { modelId: "custom:test/chat" } });
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
    expect(
      (await prisma.bot.findUnique({ where: { id: botId } }))?.memoryCapturedThrough,
    ).toBeNull();
    call.models.completeSimple.mockResolvedValue(fauxAssistantMessage([fauxText("[]")]));
    await captureConversation(conversationId, deps);
    expect(call.models.completeSimple).toHaveBeenCalledTimes(2);
    expect(
      (await prisma.bot.findUnique({ where: { id: botId } }))?.memoryCapturedThrough?.getTime(),
    ).toBe(messages[0].createdAt);
  });

  it("leaves malformed extractions uncommitted and skips peer/routine-only windows", async () => {
    const { botId, conversationId } = await seedBot();
    const call = sideCall(fauxAssistantMessage([fauxText("not json")]));
    await captureConversation(conversationId, {
      sideCall: call,
      readTranscript: async () => [
        { role: "user", text: "I prefer TypeScript, never JavaScript", createdAt: Date.now() },
      ],
    });
    expect(
      (await prisma.bot.findUnique({ where: { id: botId } }))?.memoryCapturedThrough,
    ).toBeNull();
    call.models.completeSimple.mockClear();
    await captureConversation(conversationId, {
      sideCall: call,
      readTranscript: async () => [
        { role: "user", text: "Peer ".repeat(60), peer: { kind: "request" }, createdAt: 1 },
        { role: "assistant", text: "Peer reply", createdAt: 2 },
        { role: "user", text: composeRoutinePrompt("Daily", "News", new Date()), createdAt: 3 },
      ],
    });
    expect(call.models.completeSimple).not.toHaveBeenCalled();
  });
});

describe("startMemoryCapture debounce", () => {
  it("fires on the quiet window and pushes back on new turns", async () => {
    vi.useFakeTimers();
    const listeners = new Set<(change: { conversation: number; busy: boolean }) => void>();
    const captureNow = vi.fn().mockResolvedValue(undefined);
    const stop = startMemoryCapture(
      {
        onActivity: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      },
      { models: undefined, captureNow, quietMs: 100, turnLimit: 6 },
    );
    const emit = (busy: boolean) => listeners.forEach((l) => l({ conversation: 7, busy }));
    emit(false); // turn 1
    vi.advanceTimersByTime(50);
    emit(false); // turn 2 pushes the window back
    vi.advanceTimersByTime(60);
    expect(captureNow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(captureNow).toHaveBeenCalledWith(7);
    stop();
    vi.useRealTimers();
  });

  it("does not run a second capture while one is inflight", async () => {
    vi.useFakeTimers();
    const listeners = new Set<(change: { conversation: number; busy: boolean }) => void>();
    const gates: Array<() => void> = [];
    const captureNow = vi.fn(() => new Promise<void>((resolve) => gates.push(resolve)));
    const stop = startMemoryCapture(
      {
        onActivity: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      },
      { models: undefined, captureNow, quietMs: 100_000, turnLimit: 3 },
    );
    const emit = () => listeners.forEach((l) => l({ conversation: 9, busy: false }));
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
    stop();
    vi.useRealTimers();
  });

  it("forces a capture at the turn limit", async () => {
    vi.useFakeTimers();
    const listeners = new Set<(change: { conversation: number; busy: boolean }) => void>();
    const captureNow = vi.fn().mockResolvedValue(undefined);
    const stop = startMemoryCapture(
      {
        onActivity: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      },
      { models: undefined, captureNow, quietMs: 100_000, turnLimit: 3 },
    );
    const emit = () => listeners.forEach((l) => l({ conversation: 9, busy: false }));
    emit();
    emit();
    expect(captureNow).not.toHaveBeenCalled();
    emit();
    expect(captureNow).toHaveBeenCalledWith(9);
    stop();
    vi.useRealTimers();
  });
});

describe("captureConversation and removed memories", () => {
  it("shows the newest 30 deleted memories to the extractor, which then leaves them out", async () => {
    const { botId, conversationId } = await seedBot();
    await prisma.memory.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({
        botId,
        text: `Removed fact ${String(i).padStart(2, "0")}.`,
        category: "fact",
        status: "deleted",
        updatedAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
      })),
    });
    await prisma.memory.create({
      data: {
        botId,
        text: "Owner prefers tea",
        category: "preference",
        status: "deleted",
        updatedAt: new Date(Date.UTC(2026, 9, 2)),
      },
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
    const active = await prisma.memory.findMany({ where: { botId, status: "active" } });
    expect(active.map((m) => m.text)).toEqual(["The owner lives in Chennai."]);
  });
});
