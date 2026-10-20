import { describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import {
  buildCapturePrompt,
  parseExtraction,
  applyExtraction,
  startMemoryCapture,
} from "../../../../apps/web/src/server/api/bots/memories.capture";
import {
  ownerWindow,
  captureConversation,
} from "../../../../apps/web/src/server/api/bots/memories.runner";

const conversationId = () => Math.floor(Math.random() * 1_000_000_000);

async function seedBot(): Promise<{ botId: string; conversationId: number }> {
  const conv = conversationId();
  const bot = await prisma.bot.create({
    data: { name: "Cap", modelId: "m", conversationId: String(conv) },
  });
  return { botId: bot.id, conversationId: conv };
}

describe("buildCapturePrompt", () => {
  it("carries the anti-junk rules and JSON contract", () => {
    const prompt = buildCapturePrompt({
      botName: "Scout",
      transcript: "Owner: hi",
      currentMemories: null,
    });
    expect(prompt).toContain("CAPTURE step");
    expect(prompt).toContain("Never secrets");
    expect(prompt).toContain("supersedesIds");
    expect(prompt).toContain("third person");
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

describe("ownerWindow", () => {
  const msgs = [
    { role: "user", text: "old turn", createdAt: 1, peer: undefined },
    { role: "user", text: "peer delivery", createdAt: 5, peer: { kind: "reply", name: "Bot" } },
    { role: "assistant", text: "reply", createdAt: 6 },
    { role: "user", text: "I prefer pnpm", createdAt: 10 },
  ];

  it("counts only owner-authored user turns after the watermark", () => {
    const w = ownerWindow(msgs, new Date(2));
    expect(w.turns).toBe(1);
    expect(w.lines).toEqual(["Owner: I prefer pnpm"]);
    expect(w.through?.getTime()).toBe(10);
  });

  it("returns no watermark when nothing qualifies", () => {
    expect(ownerWindow([], null).through).toBeNull();
  });
});

describe("captureConversation skip rules", () => {
  it("makes no model call when memory is disabled", async () => {
    const { botId, conversationId } = await seedBot();
    await prisma.bot.update({ where: { id: botId }, data: { memoryEnabled: false } });
    const completeSimple = vi.fn();
    await captureConversation(conversationId, {
      sideCall: { models: { completeSimple } as never, modelId: "m" },
      readTranscript: async () => [{ role: "user", text: "x".repeat(300), createdAt: Date.now() }],
    });
    expect(completeSimple).not.toHaveBeenCalled();
    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    expect(bot?.memoryCapturedThrough).toBeNull();
  });

  it("advances the watermark without a call for a trivial window", async () => {
    const conversationId = Math.floor(Math.random() * 1_000_000);
    await prisma.bot.create({
      data: { name: "Triv", modelId: "m", conversationId: String(conversationId) },
    });
    const completeSimple = vi.fn();
    await captureConversation(conversationId, {
      sideCall: { models: { completeSimple } as never, modelId: "m" },
      readTranscript: async () => [{ role: "user", text: "hi", createdAt: Date.now() }],
    });
    expect(completeSimple).not.toHaveBeenCalled();
    const bot = await prisma.bot.findUnique({ where: { conversationId: String(conversationId) } });
    expect(bot?.memoryCapturedThrough).not.toBeNull();
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
