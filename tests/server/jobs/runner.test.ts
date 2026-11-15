import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "@groot/core/database";
import { config } from "@groot/core/config";
import { setErrorReporter } from "@groot/core/errors";
import {
  JOB_TIMEOUT_ERROR,
  addJob,
  cancelJob,
  deleteJob,
  getJobById,
  getJobLogs,
  jobRunner,
  jobSchedules,
  jobs,
  registerJobHandler,
  rerunJob,
  resumeJob,
  retryJob,
  runTick,
  scheduleJob,
  startWorkers,
  stopWorkers,
  tickInFlight,
} from "@groot/jobs/server";
import { FIXED_NOW } from "../../test-clock";

async function load(id: string) {
  const job = await getJobById(id);
  if (!job) throw new Error(`job ${id} is gone`);
  return job;
}

/** Put a job in `active` as if a process claimed it and then crashed. */
async function crashWhileActive(id: string): Promise<void> {
  const longAgo = new Date(Date.now() - (config.jobs.activeTimeoutSeconds + 1) * 1000);
  await db.update(jobs).set({ state: "active", startedAt: longAgo }).where(eq(jobs.id, id));
}

beforeEach(async () => {
  jobRunner.reset();
  await db.delete(jobs);
  await db.delete(jobSchedules);
});

describe("retry policy", () => {
  afterEach(() => setErrorReporter(() => undefined));

  it("backs off, logs and reports a handler failure and a timeout the same way", async () => {
    const reported: unknown[] = [];
    setErrorReporter((_error, context) => reported.push(context?.jobId));
    registerJobHandler("policy-fails", () => {
      throw new Error("boom");
    });
    // No handler for "policy-crashes": the test plays the process that claimed it and died.
    const options = { retryLimit: 2, retryDelaySeconds: 10 };
    const failed = await addJob("policy-fails", null, options);
    const crashed = await addJob("policy-crashes", null, options);

    const rounds = [
      { delaySeconds: 10, state: "created", retryCount: 1 },
      { delaySeconds: 20, state: "created", retryCount: 2 },
      { delaySeconds: null, state: "failed", retryCount: 2 },
    ] as const;
    for (const [index, round] of rounds.entries()) {
      await crashWhileActive(crashed);
      await runTick({ housekeeping: false });

      for (const [id, error] of [
        [failed, "boom"],
        [crashed, JOB_TIMEOUT_ERROR],
      ] as const) {
        const job = await load(id);
        expect(job, `${id} after round ${index}`).toMatchObject({
          state: round.state,
          retryCount: round.retryCount,
          error,
        });
        if (round.delaySeconds === null) {
          expect(job.completedAt?.getTime()).toBe(Date.now());
        } else {
          expect(job.runAt.getTime()).toBe(Date.now() + round.delaySeconds * 1000);
          expect(job.startedAt).toBeNull();
        }
      }
      expect(reported.splice(0)).toEqual(expect.arrayContaining([failed, crashed]));
      if (round.delaySeconds !== null) vi.setSystemTime(Date.now() + round.delaySeconds * 1000);
    }

    const errorLines = async (id: string) =>
      (await getJobLogs({ jobId: id })).filter((l) => l.level === "error").map((l) => l.message);
    expect(await errorLines(failed)).toEqual(Array(3).fill("Job policy-fails failed"));
    expect(await errorLines(crashed)).toEqual(Array(3).fill("Job policy-crashes timed out"));
  });

  it("leaves a job alone when its attempt moved on before the timeout landed", async () => {
    const id = await addJob("policy-raced", null, { retryLimit: 1 });
    await crashWhileActive(id);
    const [stale] = await db.select().from(jobs).where(eq(jobs.id, id));
    // Another process recovered it and a fresh claim started a new attempt.
    await db.update(jobs).set({ startedAt: new Date() }).where(eq(jobs.id, id));

    expect(await jobRunner.transitions.apply(stale!, { type: "timeout" })).toBeNull();
    expect(await load(id)).toMatchObject({ state: "active", retryCount: 0, error: null });
  });
});

describe("inline tick", () => {
  const saved = { ...config.jobs };
  const runInline = () => Object.assign(config.jobs, { enabled: true, runInline: true });

  afterEach(async () => {
    Object.assign(config.jobs, saved);
    await jobRunner.idle();
    vi.restoreAllMocks();
  });

  async function stateOf(id: string, state: "completed" | "failed" | "cancelled") {
    await db.update(jobs).set({ state, completedAt: new Date() }).where(eq(jobs.id, id));
    return id;
  }

  /** Due `created` jobs a registered handler could take. */
  async function dueAndRunnable() {
    return db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.state, "created"),
          lte(jobs.runAt, new Date()),
          inArray(jobs.name, jobRunner.handlerNames()),
        ),
      );
  }

  // Every event, and whether it lands a due `created` job (so must nudge).
  const cases: Array<{
    event: string;
    nudges: boolean;
    arrange?: () => Promise<string>;
    act: (id: string) => Promise<unknown>;
  }> = [
    { event: "enqueue, due", nudges: true, act: () => addJob("inline", {}) },
    {
      event: "enqueue, delayed",
      nudges: false,
      act: () => addJob("inline", {}, { delaySeconds: 60 }),
    },
    { event: "enqueue, no handler", nudges: false, act: () => addJob("inline-nobody", {}) },
    {
      event: "enqueue from a schedule fire",
      nudges: true,
      arrange: async () => {
        await scheduleJob("inline", {}, "* * * * *");
        await db.update(jobSchedules).set({ createdAt: new Date(Date.now() - 120_000) });
        return "";
      },
      act: () => runTick({ housekeeping: false }),
    },
    {
      event: "retry",
      nudges: true,
      arrange: async () => stateOf(await addJob("inline", {}), "failed"),
      act: retryJob,
    },
    {
      event: "resume",
      nudges: true,
      arrange: async () => stateOf(await addJob("inline", {}), "cancelled"),
      act: resumeJob,
    },
    {
      event: "rerun",
      nudges: true,
      arrange: async () => stateOf(await addJob("inline", {}), "completed"),
      act: rerunJob,
    },
    { event: "cancel", nudges: false, arrange: () => addJob("inline", {}), act: cancelJob },
    { event: "delete", nudges: false, arrange: () => addJob("inline", {}), act: deleteJob },
    {
      event: "succeed",
      nudges: false,
      arrange: () => addJob("inline", {}),
      act: () => runTick({ housekeeping: false }),
    },
    {
      event: "fail, no backoff",
      nudges: true,
      arrange: () => addJob("inline", { failFirst: 1 }, { retryDelaySeconds: 0 }),
      act: () => runTick({ housekeeping: false }),
    },
    {
      event: "fail, with backoff",
      nudges: false,
      arrange: () => addJob("inline", { failFirst: 1 }, { retryDelaySeconds: 60 }),
      act: () => runTick({ housekeeping: false }),
    },
    {
      event: "timeout, no backoff",
      nudges: true,
      arrange: async () => {
        const id = await addJob("inline", {}, { retryDelaySeconds: 0 });
        await crashWhileActive(id);
        return id;
      },
      act: () => runTick({ housekeeping: false }),
    },
    {
      event: "timeout, with backoff",
      nudges: false,
      arrange: async () => {
        const id = await addJob("inline", {}, { retryDelaySeconds: 60 });
        await crashWhileActive(id);
        return id;
      },
      act: () => runTick({ housekeeping: false }),
    },
  ];

  it.each(cases)("$event → nudges: $nudges", async ({ nudges, arrange, act }) => {
    registerJobHandler<{ failFirst?: number }>("inline", (job) => {
      if (job.attempt <= (job.data.failFirst ?? 0)) throw new Error("not yet");
      return "ran";
    });
    const id = arrange ? await arrange() : "";
    runInline();
    const ticks = vi.spyOn(jobRunner, "runTick");

    await act(id);
    await jobRunner.idle();

    // The inline tick is the one that skips schedules; the act's own ticks do not.
    const inline = ticks.mock.calls.filter(([options]) => options?.schedules === false);
    expect(inline.length > 0).toBe(nudges);
    if (nudges) expect(await dueAndRunnable()).toEqual([]);
  });

  it("does not nudge while the queue is disabled or not inline", async () => {
    registerJobHandler("inline", () => "ran");
    const ticks = vi.spyOn(jobRunner, "runTick");
    for (const jobsConfig of [
      { enabled: false, runInline: true },
      { enabled: true, runInline: false },
    ]) {
      Object.assign(config.jobs, jobsConfig);
      const id = await addJob("inline", {});
      expect((await load(id)).state).toBe("created");
    }
    expect(ticks).not.toHaveBeenCalled();
  });
});

describe("tick scheduling", () => {
  it("runs one more pass after a tick when a tick is asked for mid-tick", async () => {
    let started!: () => void;
    let release!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ran: string[] = [];
    registerJobHandler<string>("ordered", async (job) => {
      if (job.data === "first") {
        started();
        await gate;
      }
      ran.push(job.data);
    });

    await addJob("ordered", "first");
    const first = runTick({ housekeeping: false });
    await running;
    await addJob("ordered", "second");
    // One tick at a time: the second call joins the running one.
    expect(runTick()).toBe(first);
    release();

    expect(await first).toMatchObject({ claimed: 1, completed: 1 });
    await tickInFlight();
    expect(ran).toEqual(["first", "second"]);
  });

  it("forgets a pending re-run on reset", async () => {
    let started!: () => void;
    let release!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ran: string[] = [];
    const handler = async (job: { data: string }) => {
      if (job.data === "first") {
        started();
        await gate;
      }
      ran.push(job.data);
    };
    registerJobHandler<string>("held", handler);
    await addJob("held", "first");
    const first = runTick({ housekeeping: false });
    await running;
    const second = await addJob("held", "second");
    void runTick();
    jobRunner.reset();
    // reset drops handlers too. Put one back so a forgotten re-run would run the second job.
    registerJobHandler<string>("held", handler);
    release();
    await first;
    await tickInFlight();
    expect(ran).toEqual(["first"]);
    expect((await load(second)).state).toBe("created");
  });

  it("forgets a pending re-run on stop", async () => {
    let started!: () => void;
    let release!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ran: string[] = [];
    registerJobHandler<string>("held", async (job) => {
      if (job.data === "first") {
        started();
        await gate;
      }
      ran.push(job.data);
    });
    await addJob("held", "first");
    const first = runTick({ housekeeping: false });
    await running;
    const second = await addJob("held", "second");
    void runTick();
    const stopped = jobRunner.stop();
    release();
    await first;
    await stopped;
    expect(ran).toEqual(["first"]);
    expect((await load(second)).state).toBe("created");
  });
});

describe("startWorkers / stopWorkers", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(async () => {
    await stopWorkers();
    vi.useRealTimers();
  });

  it("ticks at once, polls every interval, and stops polling on stopWorkers", async () => {
    const ran: string[] = [];
    registerJobHandler<string>("poll", (job) => {
      ran.push(job.data);
    });
    await addJob("poll", "queued before start");

    await startWorkers();
    expect(ran).toEqual(["queued before start"]);
    await startWorkers();
    expect(vi.getTimerCount()).toBe(1);

    await addJob("poll", "polled");
    await vi.advanceTimersByTimeAsync(config.jobs.pollIntervalSeconds * 1000);
    await tickInFlight();
    expect(ran).toEqual(["queued before start", "polled"]);

    await stopWorkers();
    expect(vi.getTimerCount()).toBe(0);
    await addJob("poll", "after stop");
    await vi.advanceTimersByTimeAsync(10 * config.jobs.pollIntervalSeconds * 1000);
    await tickInFlight();
    expect(ran).toEqual(["queued before start", "polled"]);
  });

  it("does not poll without handlers", async () => {
    await startWorkers();
    expect(vi.getTimerCount()).toBe(0);
  });
});
