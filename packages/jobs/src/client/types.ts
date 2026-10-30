/**
 * A registered job/queue name. Generic string — project-specific job names
 * live with their handlers (e.g. apps/web/src/server/api/todo/todo.jobs.ts).
 */
export type JobName = string;

/**
 * Lifecycle states of a job row. Mirrors `JOB_STATES` in the server package;
 * defined here (not imported) so the client bundle has no server coupling.
 */
export type JobState = "created" | "active" | "completed" | "failed" | "cancelled";

/**
 * A job as served by `/api/v1/jobs`. Same shape as the server `Job` row, but
 * every `Date` arrives as an ISO string over JSON, so timestamps are typed as
 * `string` here.
 */
export interface Job {
  id: string;
  name: string;
  data: unknown;
  state: JobState;
  priority: number;
  retryLimit: number;
  retryCount: number;
  /** Base delay between retries, in seconds (doubles per attempt). */
  retryDelay: number;
  /** Earliest time the job may run (ISO string). */
  runAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  /** Handler return value, when JSON-serialisable. */
  output: unknown | null;
  /** Last error message. */
  error: string | null;
  /** Prevents duplicate pending jobs with the same name + key. */
  singletonKey: string | null;
}

/** A cron schedule as served by `/api/v1/jobs/schedule`. One schedule per job name. */
export interface JobSchedule {
  name: string;
  cron: string;
  data: unknown;
  timezone: string | null;
  /** Last time the tick enqueued a job for this schedule (ISO string). */
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Dashboard-side name for a {@link JobSchedule} row. */
export type ScheduledJob = JobSchedule;

/** Per-state job counts from `/api/v1/jobs/stats`. */
export type JobStats = Record<JobState, number>;

export interface JobLog {
  id: number;
  jobId: string;
  jobName: string | null;
  level: string;
  message: string;
  data: unknown;
  timestamp: string;
}

/** Options accepted by `POST /api/v1/jobs`. */
export interface AddJobOptions {
  /** Retries after the first failure. */
  retryLimit?: number;
  /** Base delay between retries in seconds; doubles each attempt. */
  retryDelaySeconds?: number;
  /** Higher runs first. */
  priority?: number;
  /** Delay the first run. */
  delaySeconds?: number;
  /** Only one pending/active job per name + key. */
  singletonKey?: string;
}

/** Options accepted by `POST /api/v1/jobs/schedule` and `PUT /api/v1/jobs/schedule/:jobName`. */
export interface ScheduleJobOptions {
  /** IANA timezone for the cron expression. Defaults to UTC. */
  timezone?: string;
}
