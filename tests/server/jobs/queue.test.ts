import { beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "@groot/core/database";
import { config } from "@groot/core/config";
import {
  JOB_ACTIONS,
  VALID_JOB_STATES,
  addJob,
  canApplyJobAction,
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
  type JobAction,
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

  it("rejects an empty job name; route words are fine as names", async () => {
    await expect(addJob("", {})).rejects.toThrow(/Invalid job name/);
    registerJobHandler("stats", () => undefined);
    expect((await load(await addJob("stats", {}))).name).toBe("stats");
  });

  it("supports cancel, resume, retry, rerun and delete", async () => {
    registerJobHandler("manual", () => {
      throw new Error("always");
    });
    const id = await addJob("manual", { x: 1 }, { retryLimit: 0 });

    await cancelJob(id);
    expect((await load(id)).state).toBe("cancelled");
    await expect(cancelJob(id)).rejects.toThrow(/Cannot cancel a cancelled job/);

    await resumeJob(id);
    expect((await load(id)).state).toBe("created");

    await runTick();
    expect((await load(id)).state).toBe("failed");

    await retryJob(id);
    expect(await load(id)).toMatchObject({ state: "created", error: null });
    await expect(resumeJob(id)).rejects.toThrow(/Cannot resume a created job/);
    await expect(rerunJob(id)).rejects.toThrow(/Cannot rerun a created job/);

    await runTick();
    const copy = await rerunJob(id);
    expect((await load(copy)).data).toEqual({ x: 1 });

    await deleteJob(copy);
    expect(await getJobById(copy)).toBeNull();
    await deleteJob(id);
    await expect(deleteJob(id)).rejects.toThrow(/Job not found/);
    await expect(cancelJob("missing")).rejects.toThrow(/Job not found/);
  });

  it("accepts exactly the actions the lifecycle allows from each state", async () => {
    expect(VALID_JOB_STATES).toEqual(["created", "active", "completed", "failed", "cancelled"]);
    const calls = {
      retry: retryJob,
      rerun: rerunJob,
      resume: resumeJob,
      cancel: cancelJob,
      delete: deleteJob,
    } satisfies Record<JobAction, unknown>;
    for (const state of VALID_JOB_STATES) {
      for (const action of Object.keys(JOB_ACTIONS) as JobAction[]) {
        const id = await addJob("matrix", null);
        await db.update(jobs).set({ state }).where(eq(jobs.id, id));
        const accepted = await calls[action](id).then(
          () => true,
          () => false,
        );
        expect(accepted, `${action} from ${state}`).toBe(canApplyJobAction(action, state));
      }
    }
  });

  it("does not let a stale cancel or retry overwrite a job that moved on", async () => {
    registerJobHandler("quick", () => "done");
    const id = await addJob("quick", null);
    // The dashboard still shows the job as created; the tick finishes it first.
    await runTick();
    await expect(cancelJob(id)).rejects.toThrow(/Cannot cancel a completed job/);
    await expect(retryJob(id)).rejects.toThrow(/Cannot retry a completed job/);
    expect(await load(id)).toMatchObject({ state: "completed", output: "done" });
  });

  it("keeps a job cancelled while it was running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    registerJobHandler("slow", async () => {
      started();
      await gate;
      return "late";
    });
    const id = await addJob("slow", null);

    const tick = runTick();
    await running;
    await cancelJob(id);
    release();

    expect(await tick).toMatchObject({ claimed: 1 });
    expect(await load(id)).toMatchObject({ state: "cancelled", output: null });
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
