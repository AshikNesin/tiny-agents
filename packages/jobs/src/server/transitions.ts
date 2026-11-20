import { and, asc, desc, eq, inArray, isNull, lte, type SQL } from "drizzle-orm";
import { db } from "@groot/core/database";
import { Boom, reportError } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { JOB_ACTIONS, canApplyJobAction, type JobAction, type JobState } from "../lifecycle";
import { defaultJobOptions } from "./config";
import { createJobLogger, deleteJobLogs, flushJobLogs } from "./logger";
import { jobs, type Job, type NewJob } from "./schema";
import type { SendJobOptions } from "./types";

export interface EnqueueSpec extends SendJobOptions {
  name: string;
  data: unknown;
}

export interface JobOperatorEvent {
  type: JobAction;
}

export type JobTickEvent =
  | { type: "succeed"; output?: unknown }
  | { type: "fail"; error: unknown; durationMs?: number }
  | { type: "timeout" };

export interface JobTransitions {
  enqueue(spec: EnqueueSpec): Promise<Job>;
  apply(target: string | Job, event: JobOperatorEvent): Promise<Job>;
  apply(job: Job, event: JobTickEvent): Promise<Job | null>;
  claim(names: readonly string[], limit: number, now?: Date): Promise<Job[]>;
}

export const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

export const JOB_TIMEOUT_ERROR = "Timed out while active";

export function assertJobName(name: string): void {
  if (!name) {
    throw Boom.badRequest(`Invalid job name: ${name}`, null, "JOB_NAME_INVALID");
  }
}

export function jobNotFound(jobId: string) {
  return Boom.notFound(`Job not found: ${jobId}`, null, "JOB_NOT_FOUND");
}

export function jobActionNotAllowed(action: JobAction, state: JobState) {
  return Boom.badRequest(
    `Cannot ${action} a ${state} job (allowed from: ${JOB_ACTIONS[action].join(", ")})`,
    null,
    "JOB_ACTION_NOT_ALLOWED",
  );
}

export async function deleteJobsWhere(where: SQL | undefined): Promise<Job[]> {
  const deleted = await db.delete(jobs).where(where).returning();
  await deleteJobLogs(deleted.map((job) => job.id));
  return deleted;
}

export async function getJobById(jobId: string): Promise<Job | null> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return job ?? null;
}

function toCreated(runAt: Date): Partial<NewJob> {
  return { state: "created", runAt, startedAt: null, completedAt: null };
}

export function afterFailedAttempt(
  job: Pick<Job, "retryCount" | "retryLimit" | "retryDelay">,
  error: string,
  now: Date,
): Partial<NewJob> {
  if (job.retryCount < job.retryLimit) {
    const delayMs = Math.min(job.retryDelay * 1000 * 2 ** job.retryCount, MAX_RETRY_DELAY_MS);
    return {
      ...toCreated(new Date(now.getTime() + delayMs)),
      retryCount: job.retryCount + 1,
      error,
    };
  }
  return { state: "failed", completedAt: now, error };
}

const OPERATOR_UPDATES: Record<"retry" | "resume" | "cancel", (now: Date) => Partial<NewJob>> = {
  retry: (now) => ({ ...toCreated(now), error: null }),
  resume: (now) => toCreated(now),
  cancel: (now) => ({ state: "cancelled", completedAt: now }),
};

function serializable(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameAttempt(job: Job) {
  return and(
    eq(jobs.id, job.id),
    eq(jobs.state, "active"),
    job.startedAt ? eq(jobs.startedAt, job.startedAt) : isNull(jobs.startedAt),
  );
}

function isTickEvent(event: JobOperatorEvent | JobTickEvent): event is JobTickEvent {
  return event.type === "succeed" || event.type === "fail" || event.type === "timeout";
}

export function createJobTransitions(onDue: (job: Job) => void): JobTransitions {
  function landed(job: Job): Job {
    if (job.state === "created" && job.runAt.getTime() <= Date.now()) onDue(job);
    return job;
  }

  async function enqueue(spec: EnqueueSpec): Promise<Job> {
    assertJobName(spec.name);
    const defaults = defaultJobOptions();

    if (spec.singletonKey) {
      const [existing] = await db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.name, spec.name),
            eq(jobs.singletonKey, spec.singletonKey),
            inArray(jobs.state, ["created", "active"]),
          ),
        )
        .limit(1);
      if (existing) return existing;
    }

    const [job] = await db
      .insert(jobs)
      .values({
        id: crypto.randomUUID(),
        name: spec.name,
        data: spec.data ?? null,
        state: "created",
        priority: spec.priority ?? defaults.priority,
        retryLimit: spec.retryLimit ?? defaults.retryLimit,
        retryDelay: spec.retryDelaySeconds ?? defaults.retryDelaySeconds,
        runAt: spec.runAt ?? new Date(Date.now() + (spec.delaySeconds ?? 0) * 1000),
        singletonKey: spec.singletonKey ?? null,
      })
      .returning();
    logger.info({ jobId: job!.id, name: spec.name }, "Job queued");
    return landed(job!);
  }

  async function update(
    action: "retry" | "resume" | "cancel",
    jobId: string,
    set: Partial<NewJob>,
  ): Promise<Job> {
    const [changed] = await db
      .update(jobs)
      .set(set)
      .where(and(eq(jobs.id, jobId), inArray(jobs.state, [...JOB_ACTIONS[action]])))
      .returning();
    if (changed) return landed(changed);
    const job = await getJobById(jobId);
    if (!job) throw jobNotFound(jobId);
    throw jobActionNotAllowed(action, job.state);
  }

  async function applyOperator(jobId: string, action: JobAction): Promise<Job> {
    switch (action) {
      case "delete": {
        const [deleted] = await deleteJobsWhere(eq(jobs.id, jobId));
        if (!deleted) throw jobNotFound(jobId);
        return deleted;
      }
      case "rerun": {
        const job = await getJobById(jobId);
        if (!job) throw jobNotFound(jobId);
        if (!canApplyJobAction("rerun", job.state)) throw jobActionNotAllowed("rerun", job.state);
        return enqueue({
          name: job.name,
          data: job.data,
          priority: job.priority,
          retryLimit: job.retryLimit,
          retryDelaySeconds: job.retryDelay,
        });
      }
      default:
        return update(action, jobId, OPERATOR_UPDATES[action](new Date()));
    }
  }

  async function finish(job: Job, set: Partial<NewJob>): Promise<Job | null> {
    const [updated] = await db.update(jobs).set(set).where(sameAttempt(job)).returning();
    if (updated) return updated;
    if (!(await getJobById(job.id))) await deleteJobLogs([job.id]);
    return null;
  }

  async function failAttempt(
    job: Job,
    error: unknown,
    cause: "failed" | "timed out",
    durationMs?: number,
  ): Promise<Job | null> {
    const attempt = job.retryCount + 1;
    const jobLogger = createJobLogger({ jobId: job.id, jobName: job.name });
    jobLogger.error(
      { err: error, attempt, ...(durationMs === undefined ? {} : { duration: `${durationMs}ms` }) },
      `Job ${job.name} ${cause}`,
    );
    await flushJobLogs();
    const next = await finish(job, afterFailedAttempt(job, errorMessage(error), new Date()));
    if (!next) return null;
    reportError(error, { component: "jobs", jobName: job.name, jobId: job.id, attempt });
    return landed(next);
  }

  async function applyTick(job: Job, event: JobTickEvent): Promise<Job | null> {
    switch (event.type) {
      case "succeed":
        return finish(job, {
          state: "completed",
          completedAt: new Date(),
          output: serializable(event.output),
          error: null,
        });
      case "fail":
        return failAttempt(job, event.error, "failed", event.durationMs);
      case "timeout":
        return failAttempt(job, new Error(JOB_TIMEOUT_ERROR), "timed out");
    }
  }

  function apply(target: string | Job, event: JobOperatorEvent): Promise<Job>;
  function apply(job: Job, event: JobTickEvent): Promise<Job | null>;
  function apply(target: string | Job, event: JobOperatorEvent | JobTickEvent) {
    if (isTickEvent(event)) {
      if (typeof target === "string") throw new TypeError("A tick event needs the claimed job row");
      return applyTick(target, event);
    }
    return applyOperator(typeof target === "string" ? target : target.id, event.type);
  }

  async function claim(names: readonly string[], limit: number, now = new Date()): Promise<Job[]> {
    if (names.length === 0 || limit <= 0) return [];

    const due = db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.state, "created"), lte(jobs.runAt, now), inArray(jobs.name, [...names])))
      .orderBy(desc(jobs.priority), asc(jobs.runAt), asc(jobs.createdAt))
      .limit(limit);

    const claimed = await db
      .update(jobs)
      .set({ state: "active", startedAt: now })
      .where(and(eq(jobs.state, "created"), inArray(jobs.id, due)))
      .returning();

    return claimed.sort(
      (a, b) =>
        b.priority - a.priority ||
        a.runAt.getTime() - b.runAt.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  return { enqueue, apply, claim };
}
