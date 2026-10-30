import { beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "@groot/core/database";
import { config } from "@groot/core/config";
import {
  addJob,
  cancelJob,
  clearJobHandlers,
  deleteJob,
  getJobById,
  getJobLogs,
  getJobs,
  getQueueStats,
  jobs,
  registerJobHandler,
  rerunJob,
  resumeJob,
  retryJob,
  runTick,
} from "@groot/jobs/server";

async function load(id: string) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row!;
}

beforeEach(() => clearJobHandlers());

describe("queue + tick", () => {
  it("runs a job, stores its output and persists its logs", async () => {
    const seen: unknown[] = [];
    registerJobHandler<{ n: number }>("echo", async (job) => {
      seen.push(job.data);
      job.logger.info({ n: job.data.n }, "echoing");
      return { doubled: job.data.n * 2, attempt: job.attempt };
    });

    const id = await addJob("echo", { n: 21 });
    expect((await load(id)).state).toBe("created");

    const result = await runTick();
    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0, retried: 0 });
    expect(seen).toEqual([{ n: 21 }]);

    const job = await load(id);
    expect(job.state).toBe("completed");
    expect(job.output).toEqual({ doubled: 42, attempt: 1 });
    expect(job.startedAt).toBeInstanceOf(Date);
    expect(job.completedAt).toBeInstanceOf(Date);

    const logs = await getJobLogs({ jobId: id });
    expect(logs.map((l) => l.message)).toEqual([
      "Starting job echo",
      "echoing",
      "Job echo completed",
    ]);
    expect(logs[1]!.data).toEqual({ n: 21 });
  });

  it("retries with backoff, then fails", async () => {
    let attempts = 0;
    registerJobHandler("flaky", () => {
      attempts += 1;
      throw new Error(`attempt ${attempts} failed`);
    });
    const id = await addJob("flaky", null, { retryLimit: 1, retryDelaySeconds: 0 });

    expect(await runTick()).toMatchObject({ claimed: 1, retried: 1 });
    let job = await load(id);
    expect(job).toMatchObject({ state: "created", retryCount: 1, error: "attempt 1 failed" });

    expect(await runTick()).toMatchObject({ claimed: 1, failed: 1 });
    job = await load(id);
    expect(job).toMatchObject({ state: "failed", retryCount: 1, error: "attempt 2 failed" });
    expect(attempts).toBe(2);

    // Retry delay pushes runAt into the future so the next tick skips it.
    const delayed = await addJob("flaky", null, { retryLimit: 1, retryDelaySeconds: 600 });
    await runTick();
    expect((await load(delayed)).runAt.getTime()).toBeGreaterThan(Date.now() + 500_000);
    expect((await runTick()).claimed).toBe(0);
  });

  it("respects runAt, priority and registered handlers", async () => {
    const order: string[] = [];
    registerJobHandler<string>("ordered", (job) => {
      order.push(job.data);
    });
    await addJob("ordered", "low", { priority: 0 });
    await addJob("ordered", "high", { priority: 10 });
    await addJob("ordered", "later", { delaySeconds: 3600 });
    await addJob("unregistered", {});

    const result = await runTick();
    expect(result.claimed).toBe(2);
    expect(order).toEqual(["high", "low"]);
    const ordered = await getJobs({ name: "ordered" });
    expect(ordered.jobs.map((j) => [j.data, j.state]).sort()).toEqual([
      ["high", "completed"],
      ["later", "created"],
      ["low", "completed"],
    ]);
    expect((await getJobs({ name: "unregistered" })).jobs[0]?.state).toBe("created");
    expect((await getQueueStats()).completed).toBeGreaterThanOrEqual(2);
  });

  it("deduplicates by singletonKey while pending", async () => {
    registerJobHandler("single", () => undefined);
    const first = await addJob("single", { a: 1 }, { singletonKey: "k" });
    const second = await addJob("single", { a: 2 }, { singletonKey: "k" });
    expect(second).toBe(first);
    await runTick();
    const third = await addJob("single", { a: 3 }, { singletonKey: "k" });
    expect(third).not.toBe(first);
  });

  it("rejects reserved names", async () => {
    await expect(addJob("stats", {})).rejects.toThrow(/Invalid job name/);
    expect(() => registerJobHandler("schedule", () => undefined)).toThrow(/reserved/);
  });

  it("supports cancel, resume, retry, rerun and delete", async () => {
    registerJobHandler("manual", () => {
      throw new Error("always");
    });
    const id = await addJob("manual", { x: 1 }, { retryLimit: 0 });

    await cancelJob({ queueName: "manual", jobId: id });
    expect((await load(id)).state).toBe("cancelled");
    await expect(cancelJob({ queueName: "manual", jobId: id })).rejects.toThrow(
      /Only pending or active/,
    );

    await resumeJob({ queueName: "manual", jobId: id });
    expect((await load(id)).state).toBe("created");

    await runTick();
    expect((await load(id)).state).toBe("failed");

    await retryJob({ queueName: "manual", jobId: id });
    expect(await load(id)).toMatchObject({ state: "created", error: null });
    await expect(resumeJob({ queueName: "manual", jobId: id })).rejects.toThrow(/Only cancelled/);

    const copy = await rerunJob({ queueName: "manual", jobId: id });
    expect((await load(copy)).data).toEqual({ x: 1 });

    await deleteJob({ queueName: "manual", jobId: copy });
    expect(await getJobById({ queueName: "manual", jobId: copy })).toBeNull();
    await expect(deleteJob({ queueName: "other", jobId: id })).rejects.toThrow(/Job not found/);
  });

  it("recovers jobs stuck in active past the timeout", async () => {
    registerJobHandler("stuck", () => "ok");
    const id = await addJob("stuck", null, { retryLimit: 3 });
    const longAgo = new Date(Date.now() - (config.jobs.activeTimeoutSeconds + 60) * 1000);
    await db.update(jobs).set({ state: "active", startedAt: longAgo }).where(eq(jobs.id, id));

    const result = await runTick();
    expect(result.claimed).toBe(1);
    expect(await load(id)).toMatchObject({ state: "completed", retryCount: 1, output: "ok" });
  });
});
