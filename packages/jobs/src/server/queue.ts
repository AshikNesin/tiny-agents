import { and, eq, inArray } from "drizzle-orm";
import { Cron } from "croner";
import { db } from "@groot/core/database";
import { config } from "@groot/core/config";
import { Boom, ErrorCode } from "@groot/core/errors";
import { logger, waitUntil } from "@groot/core/logger";
import { isReservedQueueName } from "./constants";
import { defaultJobOptions } from "./config";
import { jobs, jobSchedules, type Job, type JobSchedule } from "./schema";
import { getJobHandler } from "./worker";
import { runTick } from "./tick";
import type { BulkRerunResult, RerunJobOptions, ScheduleJobOptions, SendJobOptions } from "./types";

function assertJobName(name: string): void {
  if (!name || isReservedQueueName(name)) {
    throw Boom.badRequest(`Invalid job name: ${name}`, null, ErrorCode.JOB_NAME_INVALID.code);
  }
}

/** Queue a job. Returns its id. */
export async function addJob<T = unknown>(
  name: string,
  data: T,
  options: SendJobOptions = {},
): Promise<string> {
  assertJobName(name);
  const defaults = defaultJobOptions();
  const runAt = options.runAt ?? new Date(Date.now() + (options.delaySeconds ?? 0) * 1000);

  if (options.singletonKey) {
    const [existing] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.name, name),
          eq(jobs.singletonKey, options.singletonKey),
          inArray(jobs.state, ["created", "active"]),
        ),
      )
      .limit(1);
    if (existing) return existing.id;
  }

  const id = crypto.randomUUID();
  await db.insert(jobs).values({
    id,
    name,
    data: data ?? null,
    state: "created",
    priority: options.priority ?? defaults.priority,
    retryLimit: options.retryLimit ?? defaults.retryLimit,
    retryDelay: options.retryDelaySeconds ?? defaults.retryDelaySeconds,
    runAt,
    singletonKey: options.singletonKey ?? null,
  });
  logger.info({ jobId: id, name }, "Job queued");

  // Run promptly instead of waiting for the next poll / cron fire. On Workers
  // this rides the request's waitUntil; on Node it is a detached tick.
  if (
    config.jobs.enabled &&
    config.jobs.runInline &&
    runAt.getTime() <= Date.now() &&
    getJobHandler(name)
  ) {
    waitUntil(runTick({ schedules: false, housekeeping: false }));
  }
  return id;
}

function assertCron(cron: string, timezone?: string): void {
  try {
    new Cron(cron, { timezone });
  } catch (error) {
    throw Boom.badRequest(
      `Invalid cron expression: ${error instanceof Error ? error.message : String(error)}`,
      null,
      ErrorCode.JOB_SCHEDULE_VALIDATION_ERROR.code,
    );
  }
}

/** Create or replace the recurring schedule for `name`. */
export async function scheduleJob(
  name: string,
  data: unknown,
  cron: string,
  options: ScheduleJobOptions = {},
): Promise<JobSchedule> {
  assertJobName(name);
  assertCron(cron, options.timezone);
  const values = { name, cron, data: data ?? null, timezone: options.timezone ?? null };
  const [schedule] = await db
    .insert(jobSchedules)
    .values(values)
    .onConflictDoUpdate({ target: jobSchedules.name, set: { ...values, updatedAt: new Date() } })
    .returning();
  logger.info({ name, cron }, "Job scheduled");
  return schedule!;
}

export async function editScheduledJob(
  name: string,
  cron: string,
  data: unknown,
  options: ScheduleJobOptions = {},
): Promise<JobSchedule> {
  assertCron(cron, options.timezone);
  const [schedule] = await db
    .update(jobSchedules)
    .set({ cron, data: data ?? null, timezone: options.timezone ?? null, updatedAt: new Date() })
    .where(eq(jobSchedules.name, name))
    .returning();
  if (!schedule) throw Boom.notFound(`Schedule not found: ${name}`);
  logger.info({ name, cron }, "Job schedule updated");
  return schedule;
}

export async function cancelScheduledJob(name: string): Promise<void> {
  const deleted = await db.delete(jobSchedules).where(eq(jobSchedules.name, name)).returning();
  if (deleted.length === 0) throw Boom.notFound(`Schedule not found: ${name}`);
  logger.info({ name }, "Job schedule removed");
}

async function requireJob(queueName: string, jobId: string): Promise<Job> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.name, queueName)))
    .limit(1);
  if (!job) {
    throw Boom.notFound(`Job not found: ${queueName}/${jobId}`, null, ErrorCode.JOB_NOT_FOUND.code);
  }
  return job;
}

export async function deleteJob({ queueName, jobId }: RerunJobOptions): Promise<void> {
  await requireJob(queueName, jobId);
  await db.delete(jobs).where(eq(jobs.id, jobId));
}

/** Put a failed or cancelled job back on the queue. */
export async function retryJob({ queueName, jobId }: RerunJobOptions): Promise<void> {
  const job = await requireJob(queueName, jobId);
  if (job.state !== "failed" && job.state !== "cancelled") {
    throw Boom.badRequest(`Only failed or cancelled jobs can be retried (state: ${job.state})`);
  }
  await db
    .update(jobs)
    .set({ state: "created", runAt: new Date(), startedAt: null, completedAt: null, error: null })
    .where(eq(jobs.id, jobId));
  if (config.jobs.enabled && config.jobs.runInline) {
    waitUntil(runTick({ schedules: false, housekeeping: false }));
  }
}

export async function cancelJob({ queueName, jobId }: RerunJobOptions): Promise<void> {
  const job = await requireJob(queueName, jobId);
  if (job.state !== "created" && job.state !== "active") {
    throw Boom.badRequest(`Only pending or active jobs can be cancelled (state: ${job.state})`);
  }
  await db
    .update(jobs)
    .set({ state: "cancelled", completedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

export async function resumeJob({ queueName, jobId }: RerunJobOptions): Promise<void> {
  const job = await requireJob(queueName, jobId);
  if (job.state !== "cancelled") {
    throw Boom.badRequest(`Only cancelled jobs can be resumed (state: ${job.state})`);
  }
  await db
    .update(jobs)
    .set({ state: "created", runAt: new Date(), completedAt: null })
    .where(eq(jobs.id, jobId));
}

/** Queue a fresh copy of an existing job. */
export async function rerunJob({ queueName, jobId }: RerunJobOptions): Promise<string> {
  const job = await requireJob(queueName, jobId);
  return addJob(job.name, job.data, {
    priority: job.priority,
    retryLimit: job.retryLimit,
    retryDelaySeconds: job.retryDelay,
  });
}

export async function rerunJobs(targets: RerunJobOptions[]): Promise<BulkRerunResult[]> {
  const results = await Promise.allSettled(targets.map((target) => rerunJob(target)));
  return results.map((result, index) => {
    const target = targets[index]!;
    return result.status === "fulfilled"
      ? { ...target, success: true, newJobId: result.value }
      : {
          ...target,
          success: false,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        };
  });
}
