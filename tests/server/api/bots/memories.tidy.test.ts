import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { asc, eq } from "drizzle-orm";
import { memoryLedger } from "../../../../apps/web/src/server/api/bots/memories.ledger";
import {
  setMemoryTidier,
  tidyAllMemories,
  tidyBotMemories,
} from "../../../../apps/web/src/server/api/bots/memories.tidy";
import type { SideCaller } from "../../../../apps/web/src/server/api/bots/side-call";
import { bots, db, memories } from "../../../../apps/web/src/server/db";
import { resetAppTables, seedBot } from "../../fixtures";
import { FIXED_NOW } from "../../../test-clock";

afterEach(async () => {
  vi.setSystemTime(FIXED_NOW);
  await resetAppTables();
});

const FACTS = [
  "The owner prefers TypeScript.",
  "The owner prefers TypeScript over JavaScript for new projects.",
  "The owner is travelling to Goa until last week.",
  "The owner lives in Chennai.",
  "The owner has a dog named Bruno.",
  "The owner drinks filter coffee.",
  "The owner runs on weekday mornings.",
  "The owner works at a startup.",
  "The owner uses a Pixel phone.",
  "The owner reads before bed.",
];

async function seedMemories() {
  const bot = await seedBot({ name: "Tidy", modelId: "m" });
  await memoryLedger(bot.id).add(
    FACTS.map((text) => ({ text, category: "fact" as const })),
    { source: "capture" },
  );
  return bot.id;
}

const rowsOf = (botId: string) =>
  db.query.memories.findMany({ where: eq(memories.botId, botId), orderBy: asc(memories.text) });

const caller = (reply: string) => {
  const complete = vi.fn<SideCaller["complete"]>().mockResolvedValue(reply);
  return { complete };
};

describe("weekly memory tidy", () => {
  it("merges duplicates into one memory and expires a stale one, visibly", async () => {
    const botId = await seedMemories();
    const sideCaller = caller(
      JSON.stringify({
        merge: [
          {
            refs: ["m1", "m2"],
            text: "The owner prefers TypeScript over JavaScript for new projects.",
            category: "preference",
          },
        ],
        stale: ["m3"],
      }),
    );
    expect(await tidyBotMemories(botId, sideCaller)).toEqual({ merged: 1, staled: 1 });

    const rows = await rowsOf(botId);
    const kept = rows.find((row) => row.text.endsWith("for new projects."))!;
    const dropped = rows.find((row) => row.text === "The owner prefers TypeScript.")!;
    expect(kept).toMatchObject({ status: "active", category: "preference" });
    expect(dropped).toMatchObject({ status: "superseded", supersededById: kept.id });
    expect(rows.find((row) => row.text.includes("Goa"))?.status).toBe("expired");
    expect(rows.filter((row) => row.status === "active")).toHaveLength(8);
    const prompt = sideCaller.complete.mock.calls[0]![0].system;
    expect(prompt).toContain("- m1 [fact] The owner prefers TypeScript.");
    expect(prompt).toContain("- m10 [fact] The owner reads before bed.");
  });

  it("does not call the model again until a memory changes", async () => {
    const botId = await seedMemories();
    const sideCaller = caller('{"merge":[],"stale":[]}');
    await tidyBotMemories(botId, sideCaller);
    await tidyBotMemories(botId, sideCaller);
    expect(sideCaller.complete).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(Date.parse(FIXED_NOW) + 60_000));
    await memoryLedger(botId).add([{ text: "The owner bakes bread.", category: "habit" }], {
      source: "capture",
    });
    await tidyBotMemories(botId, sideCaller);
    expect(sideCaller.complete).toHaveBeenCalledTimes(2);
  });

  it("skips a bot with few memories or memory off", async () => {
    const few = await seedBot({ name: "Few", modelId: "m" });
    await memoryLedger(few.id).add([{ text: "The owner likes tea.", category: "preference" }], {
      source: "capture",
    });
    const off = await seedMemories();
    await db.update(bots).set({ memoryEnabled: false }).where(eq(bots.id, off));
    const sideCaller = caller('{"merge":[],"stale":[]}');
    expect(await tidyBotMemories(few.id, sideCaller)).toBeUndefined();
    expect(await tidyBotMemories(off, sideCaller)).toBeUndefined();
    expect(sideCaller.complete).not.toHaveBeenCalled();
  });

  it("refuses a plan that would change over half the memories", async () => {
    const botId = await seedMemories();
    const sideCaller = caller(JSON.stringify({ stale: ["m1", "m2", "m3", "m4", "m5", "m6"] }));
    expect(await tidyBotMemories(botId, sideCaller)).toBeUndefined();
    expect((await rowsOf(botId)).every((row) => row.status === "active")).toBe(true);
  });

  it("leaves memories alone when the reply is not the expected JSON", async () => {
    const botId = await seedMemories();
    expect(await tidyBotMemories(botId, caller("Looks fine to me!"))).toBeUndefined();
    expect((await rowsOf(botId)).every((row) => row.status === "active")).toBe(true);
  });

  it("the weekly pass tidies every bot with memory on, and nothing without a model", async () => {
    const on = await seedMemories();
    const off = await seedMemories();
    await db.update(bots).set({ memoryEnabled: false }).where(eq(bots.id, off));
    await tidyAllMemories();
    const sideCaller = caller('{"merge":[],"stale":[]}');
    setMemoryTidier({ sideCaller });
    try {
      await tidyAllMemories();
    } finally {
      setMemoryTidier(undefined);
    }
    expect(sideCaller.complete).toHaveBeenCalledTimes(1);
    expect(sideCaller.complete.mock.calls[0]![0].botId).toBe(on);
  });
});
