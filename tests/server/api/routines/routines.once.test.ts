/**
 * One-time routines at the service boundary (issues #73, #74): a time in the
 * past is refused on create and reschedule, a one-shot whose time has passed
 * cannot be re-armed, it reads as done rather than paused, and its preview
 * and lateness wording stay sane. Real SQLite test DB, queue mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import * as service from "../../../../apps/web/src/server/api/routines/routines.service";
import {
  composeRoutineLabel,
  formatLateness,
} from "../../../../apps/web/src/server/api/routines/routines.schedule";

vi.mock("@groot/jobs/server/client", () => ({
  getJobQueue: () => ({
    send: vi.fn(async () => "job-1"),
    cancelJob: vi.fn(async () => true),
    createQueue: vi.fn(async () => undefined),
  }),
  jobQueueReady: () => true,
}));

const HOUR = 60 * 60_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function seedBot() {
  return prisma.bot.create({ data: { name: "Bot", modelId: "m1", conversationId: "7" } });
}

describe("one-time routines", () => {
  beforeEach(async () => {
    await prisma.routineRun.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.bot.deleteMany();
  });

  afterEach(async () => {
    await prisma.routineRun.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.bot.deleteMany();
  });

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
    expect(await prisma.routine.count()).toBe(0);
  });

  it("refuses a past time on reschedule, but allows other edits of a spent one-shot", async () => {
    const bot = await seedBot();
    const routine = await prisma.routine.create({
      data: {
        botId: bot.id,
        name: "ran",
        prompt: "hi",
        schedule: { kind: "once", at: iso(-HOUR) },
        enabled: false,
      },
    });
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
    const routine = await prisma.routine.create({
      data: {
        botId: bot.id,
        name: "ran",
        prompt: "hi",
        schedule: { kind: "once", at: iso(-HOUR) },
        enabled: false,
      },
    });
    const refusal = "This one-time routine already ran. Pick a new time to run it again.";
    await expect(service.resume(routine.id)).rejects.toMatchObject({ message: refusal });
    await expect(service.update(routine.id, { enabled: true })).rejects.toMatchObject({
      message: refusal,
    });
    const row = await prisma.routine.findUniqueOrThrow({ where: { id: routine.id } });
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
