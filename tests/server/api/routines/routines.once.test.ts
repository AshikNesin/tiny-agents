import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { db, routines } from "../../../../apps/web/src/server/db";
import * as service from "../../../../apps/web/src/server/api/routines/routines.service";
import { resetAppTables, seedBot as seedBotRow } from "../../fixtures";
import {
  composeRoutineLabel,
  formatLateness,
} from "../../../../apps/web/src/server/api/routines/routines.schedule";

const HOUR = 60 * 60_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const seedBot = () => seedBotRow({ name: "Bot", conversationId: "7" });

async function seedSpentOnce(botId: string) {
  const [routine] = await db
    .insert(routines)
    .values({
      botId,
      name: "ran",
      prompt: "hi",
      schedule: { kind: "once", at: iso(-HOUR) },
      enabled: false,
    })
    .returning();
  return routine!;
}

const clearTables = resetAppTables;

describe("one-time routines", () => {
  beforeEach(clearTables);

  afterEach(clearTables);

  it("refuses a time in the past on create", async () => {
    const bot = await seedBot();
    await expect(
      service.create({
        botId: bot.id,
        name: "past",
        prompt: "hi",
        schedule: { kind: "once", at: "2020-01-01T09:00:00+05:30" },
        enabled: true,
      }),
    ).rejects.toMatchObject({ message: "Pick a time in the future for a one-time routine" });
    expect(await db.$count(routines)).toBe(0);
  });

  it("refuses a past time on reschedule, but allows other edits of a spent one-shot", async () => {
    const bot = await seedBot();
    const routine = await seedSpentOnce(bot.id);
    await expect(
      service.update(routine.id, { schedule: { kind: "once", at: iso(-2 * HOUR) } }),
    ).rejects.toMatchObject({ message: "Pick a time in the future for a one-time routine" });
    await expect(service.update(routine.id, { name: "renamed" })).resolves.toMatchObject({
      name: "renamed",
      done: true,
    });
  });

  it("will not re-arm a one-shot that already ran, through resume or enabled:true", async () => {
    const bot = await seedBot();
    const routine = await seedSpentOnce(bot.id);
    const refusal = "This one-time routine already ran. Pick a new time to run it again.";
    await expect(service.resume(routine.id)).rejects.toMatchObject({ message: refusal });
    await expect(service.update(routine.id, { enabled: true })).rejects.toMatchObject({
      message: refusal,
    });
    const row = (await db.query.routines.findFirst({ where: eq(routines.id, routine.id) }))!;
    expect(row.enabled).toBe(false);
    expect(row.nextRunAt).toBeNull();
  });

  it("a future one-shot is armed, not done, and previews a single fire time", async () => {
    const bot = await seedBot();
    const at = iso(2 * HOUR);
    const routine = await service.create({
      botId: bot.id,
      name: "soon",
      prompt: "hi",
      schedule: { kind: "once", at },
      enabled: true,
    });
    expect(routine).toMatchObject({ enabled: true, done: false });
    expect(service.previewFireTimes({ kind: "once", at }, new Date())).toHaveLength(1);
  });
});

describe("lateness wording", () => {
  it("reads in minutes, hours or days", () => {
    expect(formatLateness(7)).toBe("7m");
    expect(formatLateness(60)).toBe("1h");
    expect(formatLateness(192)).toBe("3h 12m");
    expect(formatLateness(3_591_548)).toBe("2494 days");
    expect(composeRoutineLabel("digest", new Date("2026-10-21T03:30:00Z"), 1440)).toContain(
      "(late by 1 day)",
    );
  });
});
