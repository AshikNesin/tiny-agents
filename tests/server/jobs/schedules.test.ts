import { beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "@groot/core/database";
import {
  cancelScheduledJob,
  clearJobHandlers,
  editScheduledJob,
  getJobs,
  getScheduledJobs,
  jobSchedules,
  nextCronRun,
  registerJobHandler,
  runTick,
  scheduleJob,
} from "@groot/jobs/server";

beforeEach(async () => {
  clearJobHandlers();
  await db.delete(jobSchedules);
});

describe("schedules", () => {
  it("validates cron expressions and upserts by name", async () => {
    await expect(scheduleJob("nightly", {}, "not a cron")).rejects.toThrow(/Invalid cron/);
    await scheduleJob("nightly", { a: 1 }, "0 3 * * *");
    await scheduleJob("nightly", { a: 2 }, "0 4 * * *", { timezone: "Asia/Kolkata" });
    const [schedule] = await getScheduledJobs();
    expect(schedule).toMatchObject({
      name: "nightly",
      cron: "0 4 * * *",
      data: { a: 2 },
      timezone: "Asia/Kolkata",
    });
    expect(await getScheduledJobs()).toHaveLength(1);
  });

  it("edits and cancels", async () => {
    await scheduleJob("weekly", null, "0 9 * * 1");
    await editScheduledJob("weekly", "0 10 * * 1", { changed: true });
    expect((await getScheduledJobs())[0]).toMatchObject({
      cron: "0 10 * * 1",
      data: { changed: true },
    });
    await expect(editScheduledJob("missing", "* * * * *", null)).rejects.toThrow(/not found/);
    await cancelScheduledJob("weekly");
    await expect(cancelScheduledJob("weekly")).rejects.toThrow(/not found/);
  });

  it("enqueues a due schedule exactly once per fire", async () => {
    registerJobHandler("every-minute", () => "ran");
    await scheduleJob("every-minute", { from: "cron" }, "* * * * *");
    // Pretend the schedule was created two minutes ago so a fire is due.
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    await db
      .update(jobSchedules)
      .set({ createdAt: twoMinutesAgo })
      .where(eq(jobSchedules.name, "every-minute"));

    const first = await runTick();
    expect(first.scheduled).toBe(1);
    expect(first.completed).toBe(1);

    const second = await runTick();
    expect(second.scheduled).toBe(0);

    const { jobs: rows } = await getJobs({ name: "every-minute" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "completed", data: { from: "cron" }, output: "ran" });
    expect((await getScheduledJobs())[0]!.lastRunAt).toBeInstanceOf(Date);
  });

  it("computes the next run", () => {
    const from = new Date("2026-01-01T00:00:30Z");
    expect(nextCronRun("* * * * *", from)?.toISOString()).toBe("2026-01-01T00:01:00.000Z");
    expect(nextCronRun("0 9 * * *", from, "UTC")?.toISOString()).toBe("2026-01-01T09:00:00.000Z");
  });
});
