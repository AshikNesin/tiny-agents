import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db, kv as kvTable } from "@groot/core/database";
import { config } from "@groot/core/config";
import { kv } from "@groot/core/kv";
import {
  addJob,
  clearJobHandlers,
  deleteJob,
  getJobById,
  getJobLogs,
  housekeeping,
  jobs,
  purgeJobsByState,
  registerJobHandler,
  runTick,
} from "@groot/jobs/server";

describe("housekeeping", () => {
  it("removes old finished jobs with their logs, keeps recent and pending ones, purges expired kv", async () => {
    vi.useRealTimers(); // the kv entry's 1 ms TTL has to lapse in real time
    clearJobHandlers();
    registerJobHandler("hk", (job) => {
      job.logger.info("hello from hk");
      return "done";
    });
    const old = await addJob("hk", { which: "old" });
    const recent = await addJob("hk", { which: "recent" });
    const pending = await addJob("hk", { which: "pending" }, { delaySeconds: 3600 });
    await runTick();
    expect((await getJobLogs({ jobId: old })).length).toBeGreaterThan(0);

    const longAgo = new Date(
      Date.now() - (config.jobs.keepCompletedDays + 1) * 24 * 60 * 60 * 1000,
    );
    await db.update(jobs).set({ completedAt: longAgo }).where(eq(jobs.id, old));
    await kv.set("hk-expired", 1, 1);
    await new Promise((r) => setTimeout(r, 5));

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
  afterEach(() => vi.useRealTimers());

  const MINUTE = 60_000;
  const LAST_RUN_KEY = "jobs:housekeeping:lastRunAt";

  async function plantExpiredKv(): Promise<void> {
    await db
      .insert(kvTable)
      .values({ key: "hk-gate", value: "1", expiresAt: new Date(0) })
      .onConflictDoNothing();
  }

  async function swept(): Promise<boolean> {
    const rows = await db.select().from(kvTable).where(eq(kvTable.key, "hk-gate"));
    return rows.length === 0;
  }

  it("runs at most once per interval, even when another process ran it", async () => {
    clearJobHandlers();
    vi.useFakeTimers({ toFake: ["Date"] });
    // Later than any real-time tick in this file, so the first claim is free.
    const start = Date.now() + 24 * 60 * MINUTE;
    const at = (minutes: number) => vi.setSystemTime(start + minutes * MINUTE);

    at(0);
    await plantExpiredKv();
    await runTick();
    expect(await swept()).toBe(true);

    at(5);
    await plantExpiredKv();
    await runTick();
    expect(await swept()).toBe(false);

    // A second process (another Workers isolate) swept at minute 9.
    await db
      .update(kvTable)
      .set({ value: JSON.stringify(start + 9 * MINUTE) })
      .where(eq(kvTable.key, LAST_RUN_KEY));

    at(11);
    await runTick();
    expect(await swept()).toBe(false);

    at(19.5);
    await runTick();
    expect(await swept()).toBe(true);
    const [row] = await db.select().from(kvTable).where(eq(kvTable.key, LAST_RUN_KEY));
    expect(JSON.parse(row!.value)).toBe(start + 19.5 * MINUTE);
  });
});

describe("job logs follow their job", () => {
  it("deleteJob and purgeJobsByState remove the job's logs", async () => {
    clearJobHandlers();
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
    clearJobHandlers();
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
