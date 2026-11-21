import type { Logger } from "@groot/core/logger";

export type { Job, NewJob, JobSchedule, JobLog } from "./schema";
export type { JobAction, JobState } from "../lifecycle";
export type { JobStats, BulkRerunResult } from "./wire-types";

export interface JobContext<T = unknown> {
  id: string;
  name: string;
  data: T;
  attempt: number;
  logger: Logger;
}

export type JobHandler<T = unknown, R = unknown> = (job: JobContext<T>) => Promise<R> | R;

export interface SendJobOptions {
  retryLimit?: number;
  retryDelaySeconds?: number;
  priority?: number;
  delaySeconds?: number;
  runAt?: Date;
  singletonKey?: string;
}

export interface ScheduleJobOptions {
  timezone?: string;
}

export interface GetJobsOptions {
  state?: string;
  name?: string;
  search?: string;
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
}

export interface JobQueryResponse {
  jobs: import("./schema").Job[];
  total: number;
}

export interface TickOptions {
  limit?: number;
  schedules?: boolean;
  housekeeping?: boolean;
}

export interface TickResult {
  scheduled: number;
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
}
