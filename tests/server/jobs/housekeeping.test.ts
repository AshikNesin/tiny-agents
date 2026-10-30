import { describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "@groot/core/database";
import { config } from "@groot/core/config";
import { kv } from "@groot/core/kv";
import {
  addJob,
  clearJobHandlers,
  getJobLogs,
  housekeeping,
  jobs,
  registerJobHandler,
  runTick,
} from "@groot/jobs/server";

describe("housekeeping", () => {
  it("removes old finished jobs with their logs, keeps recent and pending ones, purges expired kv", async () => {
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
