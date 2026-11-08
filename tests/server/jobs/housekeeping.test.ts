import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "@groot/core/database";
import { config } from "@groot/core/config";
import { kv, purgeExpiredKv } from "@groot/core/kv";
import {
  addJob,
  deleteJob,
  getJobById,
  getJobLogs,
  housekeeping,
  jobRunner,
  jobs,
  purgeJobsByState,
  registerJobHandler,
  runTick,
} from "@groot/jobs/server";

// Fresh runner state per test: no handlers, no housekeeping schedule left by
// an earlier test.
beforeEach(() => jobRunner.reset());

describe("housekeeping", () => {
  it("removes old finished jobs with their logs, keeps recent and pending ones, purges expired kv", async () => {
    registerJobHandler("hk", (job) => {
      job.logger.info("hello from hk");
      return "done";
    });
    const old = await addJob("hk", { which: "old" });
    const recent = await addJob("hk", { which: "recent" });
    const pending = await addJob("hk", { which: "pending" }, { delaySeconds: 3600 });
    await runTick({ housekeeping: false });
    expect((await getJobLogs({ jobId: old })).length).toBeGreaterThan(0);

    const longAgo = new Date(
      Date.now() - (config.jobs.keepCompletedDays + 1) * 24 * 60 * 60 * 1000,
    );
    await db.update(jobs).set({ completedAt: longAgo }).where(eq(jobs.id, old));
    await kv.set("hk-expired", 1, 1);
    vi.setSystemTime(Date.now() + 5);

    await housekeeping();

    const remaining = (await db.select({ id: jobs.id }).from(jobs)).map((j) => j.id);
    expect(remaining).not.toContain(old);
    expect(remaining).toEqual(expect.arrayContaining([recent, pending]));
    expect(await getJobLogs({ jobId: old })).toEqual([]);
    expect((await getJobLogs({ jobId: recent })).length).toBeGreaterThan(0);
    expect(await kv.get("hk-expired")).toBeUndefined();
  });
});

describe("housekeeping schedule", () => {
  const MINUTE = 60_000;
  const INTERVAL = 10 * MINUTE;
  const LAST_RUN_KEY = "jobs:housekeeping:lastRunAt";

  /** An entry that will have expired by the next `at()`. */
  async function plantExpiringKv(): Promise<void> {
    await kv.set("hk-gate", 1, 1);
  }

  /** True when the last tick swept the planted entry (nothing expired is left to purge). */
  async function swept(): Promise<boolean> {
    return (await purgeExpiredKv()) === 0;
  }

  it("runs at most once per interval, even when another process ran it", async () => {
    const start = Date.now();
    const at = (minutes: number) => vi.setSystemTime(start + minutes * MINUTE);

    await plantExpiringKv();
    at(0);
    await runTick();
    expect(await swept()).toBe(true);

    await plantExpiringKv();
    at(5);
    await runTick();
    expect(await swept()).toBe(false);

    // A second process (another Workers isolate) swept at minute 10.
    at(10);
    expect(await kv.claim(LAST_RUN_KEY, INTERVAL)).toBe(true);

    await plantExpiringKv();
    at(11);
    await runTick();
    expect(await swept()).toBe(false);

    await plantExpiringKv();
    at(20.5);
    await runTick();
    expect(await swept()).toBe(true);
    expect(await kv.get(LAST_RUN_KEY)).toBe(start + 20.5 * MINUTE);
  });
});

describe("job logs follow their job", () => {
  it("deleteJob and purgeJobsByState remove the job's logs", async () => {
    registerJobHandler("logs-follow", (job) => {
      job.logger.info("hello");
    });
    const deleted = await addJob("logs-follow", {});
    const purged = await addJob("logs-follow", {});
    await runTick({ housekeeping: false });
    expect((await getJobLogs({ jobId: deleted })).length).toBeGreaterThan(0);
    expect((await getJobLogs({ jobId: purged })).length).toBeGreaterThan(0);

    await deleteJob(deleted);
    expect(await getJobLogs({ jobId: deleted })).toEqual([]);
    expect((await getJobLogs({ jobId: purged })).length).toBeGreaterThan(0);

    await purgeJobsByState({ state: "completed" });
    expect(await getJobLogs({ jobId: purged })).toEqual([]);
  });

  it("drops the logs a handler writes after its job was deleted mid-run", async () => {
    let started!: () => void;
    let release!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    registerJobHandler("deleted-mid-run", async (job) => {
      job.logger.info("before delete");
      started();
      await gate;
      job.logger.info("after delete");
    });
    const id = await addJob("deleted-mid-run", {});

    const tick = runTick({ housekeeping: false });
    await running;
    await deleteJob(id);
    release();
    await tick;

    expect(await getJobById(id)).toBeNull();
    expect(await getJobLogs({ jobId: id })).toEqual([]);
  });
});
