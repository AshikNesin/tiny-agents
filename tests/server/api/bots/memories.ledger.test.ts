import { afterEach, describe, expect, it } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { memoryLedger } from "../../../../apps/web/src/server/api/bots/memories.ledger";
import { bots, db, memories } from "../../../../apps/web/src/server/db";
import type { MemoryStatus } from "../../../../apps/web/src/shared/machines/memory";
import { resetAppTables, seedBot } from "../../fixtures";

afterEach(resetAppTables);

async function newLedger() {
  const bot = await seedBot({ name: `Ledger ${Math.random()}`, modelId: "m" });
  return { botId: bot.id, ledger: memoryLedger(bot.id) };
}

const fact = (text: string, extra: Record<string, unknown> = {}) => ({
  text,
  category: "fact" as const,
  confidence: 0.9,
  ...extra,
});

const statusOf = async (id: string) =>
  (await db.query.memories.findFirst({ where: eq(memories.id, id) }))?.status;

const count = (botId: string, status: MemoryStatus) =>
  db.$count(memories, and(eq(memories.botId, botId), eq(memories.status, status)));

describe("memoryLedger.add: dedupe", () => {
  it("never adds a second row for the same text, trimmed and case-insensitive", async () => {
    const { botId, ledger } = await newLedger();
    const first = await ledger.add([fact("Prefers pnpm")], { source: "capture" });
    expect(first).toMatchObject({ created: 1, skipped: 0 });
    const again = await ledger.add([fact("  prefers PNPM "), fact("Prefers pnpm")], {
      source: "capture",
    });
    expect(again).toMatchObject({ created: 0, skipped: 2 });
    expect(again.rows.map((row) => row.id)).toEqual([first.rows[0]!.id, first.rows[0]!.id]);
    expect(await db.$count(memories, eq(memories.botId, botId))).toBe(1);
  });

  it("never re-adds a tombstone from capture or chat", async () => {
    const { botId, ledger } = await newLedger();
    const { rows } = await ledger.add([fact("Prefers pnpm")], { source: "capture" });
    expect(await ledger.tombstone([rows[0]!.id])).toBe(1);
    expect(await ledger.add([fact("Prefers pnpm")], { source: "capture" })).toMatchObject({
      created: 0,
      skipped: 1,
    });
    expect(await count(botId, "deleted")).toBe(1);
    expect(await ledger.active()).toEqual([]);
  });

  it("lets the owner add a removed memory again, as a new one, on the same row", async () => {
    const { botId, ledger } = await newLedger();
    const { rows } = await ledger.add([fact("Prefers pnpm")], { source: "capture" });
    await ledger.tombstone([rows[0]!.id]);
    const added = await ledger.add([{ text: "prefers pnpm", category: "preference" }], {
      source: "manual",
    });
    expect(added).toMatchObject({ created: 0, revived: 1 });
    expect(added.rows[0]).toMatchObject({
      id: rows[0]!.id,
      text: "prefers pnpm",
      category: "preference",
      status: "active",
      source: "manual",
      confidence: null,
    });
    expect(added.rows[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(rows[0]!.createdAt.getTime());
    // An active match is returned as it is.
    const twice = await ledger.add([{ text: "Prefers pnpm", category: "fact" }], {
      source: "manual",
    });
    expect(twice).toMatchObject({ created: 0, revived: 0, skipped: 1 });
    expect(twice.rows[0]).toMatchObject({ id: rows[0]!.id, category: "preference" });
    expect(await db.$count(memories, eq(memories.botId, botId))).toBe(1);
  });

  it("keeps every bot's memories apart", async () => {
    const a = await newLedger();
    const b = await newLedger();
    await a.ledger.add([fact("Prefers pnpm")], { source: "capture" });
    expect(await b.ledger.add([fact("Prefers pnpm")], { source: "capture" })).toMatchObject({
      created: 1,
    });
  });
});

describe("memoryLedger.add: supersede", () => {
  it("replaces active memories of the same bot only, never a tombstone", async () => {
    const a = await newLedger();
    const b = await newLedger();
    const [old, removed] = (
      await a.ledger.add([fact("Lives in Bangalore"), fact("Works nights")], { source: "capture" })
    ).rows;
    await a.ledger.tombstone([removed!.id]);
    const [other] = (await b.ledger.add([fact("Other bot fact")], { source: "capture" })).rows;

    const result = await a.ledger.add(
      [fact("Lives in Chennai now", { supersedesIds: [old!.id, removed!.id, other!.id] })],
      { source: "capture" },
    );
    expect(result.superseded).toBe(1);
    expect(await db.query.memories.findFirst({ where: eq(memories.id, old!.id) })).toMatchObject({
      status: "superseded",
      supersededById: result.rows[0]!.id,
    });
    expect(await statusOf(removed!.id)).toBe("deleted");
    expect(await statusOf(other!.id)).toBe("active");
  });
});

describe("memoryLedger.add: budget and expiry", () => {
  it("archives the oldest active rows past the budget, never the new ones", async () => {
    const { botId, ledger } = await newLedger();
    await db.insert(memories).values(
      Array.from({ length: 100 }, (_, i) => ({
        botId,
        text: `Old fact ${i}`,
        category: "fact",
        createdAt: new Date(1_000 + i),
      })),
    );
    const { rows } = await ledger.add([fact("New fact"), fact("Newer fact")], {
      source: "manual",
    });
    expect(await count(botId, "active")).toBe(100);
    const archived = await db.query.memories.findMany({
      where: and(eq(memories.botId, botId), eq(memories.status, "archived")),
    });
    expect(archived.map((m) => m.text).sort()).toEqual(["Old fact 0", "Old fact 1"]);
    expect(rows.every((row) => row.status === "active")).toBe(true);
  });

  it("archives within one large capture, oldest first", async () => {
    const { botId, ledger } = await newLedger();
    await ledger.add(
      Array.from({ length: 105 }, (_, i) => fact(`Fact ${i}`)),
      { source: "capture" },
    );
    expect(await count(botId, "active")).toBe(100);
    expect(await count(botId, "archived")).toBe(5);
  });

  it("expires rows past their date: they leave the active set and free budget", async () => {
    const { botId, ledger } = await newLedger();
    await db.insert(memories).values([
      ...Array.from({ length: 99 }, (_, i) => ({
        botId,
        text: `Old fact ${i}`,
        category: "fact",
        createdAt: new Date(1_000 + i),
      })),
      {
        botId,
        text: "Is traveling this week",
        category: "fact",
        until: new Date("2020-01-01T00:00:00.000Z"),
        createdAt: new Date(500),
      },
    ]);
    expect((await ledger.active()).map((m) => m.text)).not.toContain("Is traveling this week");
    await ledger.add([fact("New fact")], { source: "capture" });
    expect(await count(botId, "active")).toBe(100);
    expect(await count(botId, "expired")).toBe(1);
    expect(await count(botId, "archived")).toBe(0);
  });
});

describe("memoryLedger: the watermark", () => {
  it("advances with the rows a capture adds, and with nothing when there is nothing", async () => {
    const { botId, ledger } = await newLedger();
    const through = new Date(1_700_000_000_000);
    await ledger.add([fact("Prefers pnpm")], { source: "capture", watermark: through });
    const bot = await db.query.bots.findFirst({ where: eq(bots.id, botId) });
    expect(bot?.memoryCapturedThrough?.getTime()).toBe(through.getTime());
    const later = new Date(1_700_000_100_000);
    await ledger.advanceWatermark(later);
    expect(
      (await db.query.bots.findFirst({ where: eq(bots.id, botId) }))?.memoryCapturedThrough,
    ).toEqual(later);
  });

  it("writes nothing when the watermark cannot move (the bot is gone)", async () => {
    const ghost = memoryLedger("missing-bot");
    await expect(
      ghost.add([fact("Prefers pnpm")], { source: "capture", watermark: new Date() }),
    ).rejects.toThrow();
    await expect(ghost.advanceWatermark(new Date())).rejects.toThrow();
  });
});

describe("memoryLedger.restore", () => {
  it("brings an archived memory back and keeps it, archiving the oldest other one", async () => {
    const { botId, ledger } = await newLedger();
    await db.insert(memories).values({
      botId,
      text: "Archived long ago",
      category: "fact",
      status: "archived",
      createdAt: new Date(10),
    });
    const archived = await db.query.memories.findFirst({ where: eq(memories.botId, botId) });
    await db.insert(memories).values(
      Array.from({ length: 100 }, (_, i) => ({
        botId,
        text: `Fact ${i}`,
        category: "fact",
        createdAt: new Date(1_000 + i),
      })),
    );
    expect(await ledger.restore(archived!.id)).toMatchObject({ status: "active" });
    expect(await count(botId, "active")).toBe(100);
    const nowArchived = await db.query.memories.findFirst({
      where: and(eq(memories.botId, botId), eq(memories.status, "archived")),
    });
    expect(nowArchived?.text).toBe("Fact 0");
  });

  it("leaves a tombstone deleted and another bot's row alone", async () => {
    const { ledger } = await newLedger();
    const other = await newLedger();
    const [row] = (await ledger.add([fact("Prefers pnpm")], { source: "capture" })).rows;
    await ledger.tombstone([row!.id]);
    expect(await ledger.restore(row!.id)).toMatchObject({ status: "deleted" });
    expect(await other.ledger.restore(row!.id)).toBeUndefined();
  });
});

describe("memoryLedger.promptContext", () => {
  it("lists active memories with ids and the newest removed ones", async () => {
    const { ledger } = await newLedger();
    const { rows } = await ledger.add(
      [fact("Prefers pnpm"), fact("Is in Goa", { until: "2999-01-01" }), fact("Likes tea")],
      { source: "capture" },
    );
    await ledger.tombstone([rows[2]!.id]);
    const context = await ledger.promptContext();
    expect(context.current).toBe(
      `- ${rows[0]!.id}: Prefers pnpm\n- ${rows[1]!.id}: Is in Goa (until 2999-01-01)`,
    );
    expect(context.removed).toBe("- Likes tea");
    expect(await (await newLedger()).ledger.promptContext()).toEqual({
      current: null,
      removed: null,
    });
  });
});
