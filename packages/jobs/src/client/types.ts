import type { BulkRerunResult, Job, JobLog, JobSchedule, JobStats } from "../server/wire-types";

export type JobName = string;

export type { JobAction, JobState } from "../lifecycle";
export type { BulkRerunResult, Job, JobLog, JobSchedule, JobStats };

export type ScheduledJob = JobSchedule;

export interface AddJobOptions {
  retryLimit?: number;
  retryDelaySeconds?: number;
  priority?: number;
  delaySeconds?: number;
  singletonKey?: string;
}

export interface ScheduleJobOptions {
  timezone?: string;
}
