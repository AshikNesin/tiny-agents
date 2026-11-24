import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { Cron } from "croner";
import { db } from "@groot/core/database";
import { config } from "@groot/core/config";
import { logger, logPerformance, waitUntil } from "@groot/core/logger";
import { reportError } from "@groot/core/errors";
import { kv, purgeExpiredKv } from "@groot/core/kv";
import { jobs, jobSchedules, type Job } from "./schema";
import { createJobLogger, flushJobLogs } from "./logger";
import { createJobTransitions, deleteJobsWhere, type JobTransitions } from "./transitions";
import type { JobHandler, TickOptions, TickResult } from "./types";

const HOUSEKEEPING_INTERVAL_MS = 10 * 60 * 1000;
const HOUSEKEEPING_RECHECK_MS = 60 * 1000;
const HOUSEKEEPING_KEY = "jobs:housekeeping:lastRunAt";

let nextHousekeepingCheck = 0;

const INLINE_TICK: TickOptions = { schedules: false, housekeeping: false };

function emptyResult(): TickResult {
  return { scheduled: 0, claimed: 0, completed: 0, retried: 0, failed: 0 };
}

type TickSlot =
  | { status: "idle" }
  | { status: "running"; tick: Promise<TickResult>; rerun: boolean };

export class JobRunner {
  readonly transitions: JobTransitions = createJobTransitions((job) => this.#nudge(job));

  readonly #handlers = new Map<string, JobHandler>();
  #slot: TickSlot = { status: "idle" };
  #timer: ReturnType<typeof setInterval> | null = null;

  register<T, R = unknown>(name: string, handler: JobHandler<T, R>): void {
    this.#handlers.set(name, handler as JobHandler);
    logger.debug({ jobName: name }, "Job handler registered");
  }

  handler(name: string): JobHandler | undefined {
    return this.#handlers.get(name);
  }

  handlerNames(): string[] {
    return [...this.#handlers.keys()];
  }

  runTick(options: TickOptions = {}): Promise<TickResult> {
    if (this.#slot.status === "running") {
      this.#slot = { ...this.#slot, rerun: true };
      return this.#slot.tick;
    }
    const tick = this.#tick(options)
      .catch((error: unknown) => {
        logger.error({ err: error }, "Job tick failed");
        reportError(error, { component: "jobs" });
        return emptyResult();
      })
      .finally(() => {
        const rerun = this.#slot.status === "running" && this.#slot.rerun;
        this.#slot = { status: "idle" };
        if (rerun) void this.runTick(INLINE_TICK);
      });
    this.#slot = { status: "running", tick, rerun: false };
    return tick;
  }

  async idle(): Promise<void> {
    while (this.#slot.status === "running") await this.#slot.tick;
  }

  async start(): Promise<void> {
    if (this.#timer) {
      logger.warn("Job workers already running");
      return;
    }
    if (this.#handlers.size === 0) {
      logger.error(
        "No job handlers registered — workers NOT started. Register handlers with registerJobHandler() before startWorkers().",
      );
      return;
    }

    const intervalMs = config.jobs.pollIntervalSeconds * 1000;
    this.#timer = setInterval(() => void this.runTick(), intervalMs);
    if (typeof this.#timer === "object" && "unref" in this.#timer) this.#timer.unref();

    await this.runTick();
    logger.info({ workerCount: this.#handlers.size, intervalMs }, "Job workers started");
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#dropRerun();
    await this.idle();
  }

  reset(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#handlers.clear();
    this.#dropRerun();
    nextHousekeepingCheck = 0;
  }

  #dropRerun(): void {
    if (this.#slot.status === "running") this.#slot = { ...this.#slot, rerun: false };
  }

  #nudge(job: Job): void {
    if (!config.jobs.enabled || !config.jobs.runInline || !this.#handlers.has(job.name)) return;
    waitUntil(this.runTick(INLINE_TICK).then(() => this.idle()));
  }

  async #tick(options: TickOptions): Promise<TickResult> {
    const result = emptyResult();
    const now = new Date();

    if (options.schedules ?? true) result.scheduled = await this.#materializeSchedules(now);
    await this.#recoverStuckJobs(now);

    const claimed = await this.transitions.claim(
      this.handlerNames(),
      options.limit ?? config.jobs.batchSize,
      now,
    );
    result.claimed = claimed.length;
    for (const job of claimed) {
      const outcome = await this.#run(job);
      result[outcome] += 1;
    }

    if ((options.housekeeping ?? true) && (await claimHousekeeping(now))) {
      await housekeeping(now);
    }

    return result;
  }

  async #materializeSchedules(now: Date): Promise<number> {
    const schedules = await db.select().from(jobSchedules);
    let enqueued = 0;

    for (const schedule of schedules) {
      const next = nextCronRun(
        schedule.cron,
        schedule.lastRunAt ?? schedule.createdAt,
        schedule.timezone,
      );
      if (!next || next.getTime() > now.getTime()) continue;

      const claimed = await db
        .update(jobSchedules)
        .set({ lastRunAt: now })
        .where(
          and(
            eq(jobSchedules.name, schedule.name),
            schedule.lastRunAt
              ? eq(jobSchedules.lastRunAt, schedule.lastRunAt)
              : sql`${jobSchedules.lastRunAt} IS NULL`,
          ),
        )
        .returning({ name: jobSchedules.name });
      if (claimed.length === 0) continue;

      await this.transitions.enqueue({ name: schedule.name, data: schedule.data, runAt: now });
      enqueued += 1;
    }

    return enqueued;
  }

  async #recoverStuckJobs(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - config.jobs.activeTimeoutSeconds * 1000);
    const stuck = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.state, "active"), lt(jobs.startedAt, cutoff)));
    await Promise.all(stuck.map((job) => this.transitions.apply(job, { type: "timeout" })));
  }

  async #run(job: Job): Promise<"completed" | "retried" | "failed"> {
    const handler = this.#handlers.get(job.name);
    if (!handler) {
      const next = await this.transitions.apply(job, {
        type: "fail",
        error: new Error("No handler registered"),
      });
      return next?.state === "created" ? "retried" : "failed";
    }

    const jobLogger = createJobLogger({ jobId: job.id, jobName: job.name });
    const startTime = Date.now();
    const attempt = job.retryCount + 1;
    jobLogger.info({ data: job.data, attempt }, `Starting job ${job.name}`);
    try {
      const output = await handler({
        id: job.id,
        name: job.name,
        data: job.data,
        attempt,
        logger: jobLogger,
      });
      const duration = Date.now() - startTime;
      jobLogger.info({ duration: `${duration}ms` }, `Job ${job.name} completed`);
      logPerformance({ operation: `job_${job.name}`, duration, data: { jobId: job.id } });
      await flushJobLogs();
      await this.transitions.apply(job, { type: "succeed", output });
      return "completed";
    } catch (error) {
      const duration = Date.now() - startTime;
      logPerformance({
        operation: `job_${job.name}`,
        duration,
        data: { jobId: job.id, failed: true },
      });
      const next = await this.transitions.apply(job, { type: "fail", error, durationMs: duration });
      return next?.state === "created" ? "retried" : "failed";
    }
  }
}

export const jobRunner = new JobRunner();

export function runTick(options: TickOptions = {}): Promise<TickResult> {
  return jobRunner.runTick(options);
}

export function tickInFlight(): Promise<void> {
  return jobRunner.idle();
}

async function claimHousekeeping(now: Date): Promise<boolean> {
  const nowMs = now.getTime();
  if (nowMs < nextHousekeepingCheck) return false;

  const owned = await kv.claim(HOUSEKEEPING_KEY, HOUSEKEEPING_INTERVAL_MS);
  nextHousekeepingCheck = nowMs + (owned ? HOUSEKEEPING_INTERVAL_MS : HOUSEKEEPING_RECHECK_MS);
  return owned;
}

export function nextCronRun(cron: string, from: Date, timezone?: string | null): Date | null {
  return new Cron(cron, { timezone: timezone ?? undefined }).nextRun(from);
}

export async function housekeeping(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - config.jobs.keepCompletedDays * 24 * 60 * 60 * 1000);
  await deleteJobsWhere(
    and(inArray(jobs.state, ["completed", "cancelled"]), lt(jobs.completedAt, cutoff)),
  );
  await purgeExpiredKv();
}
