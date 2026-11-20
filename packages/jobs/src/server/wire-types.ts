import type { JobState } from "../lifecycle";
import type { Job as JobRow, JobLog as JobLogRow, JobSchedule as JobScheduleRow } from "./schema";

export type Job = Omit<JobRow, "runAt" | "startedAt" | "completedAt" | "createdAt"> & {
  runAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type JobSchedule = Omit<JobScheduleRow, "lastRunAt" | "createdAt" | "updatedAt"> & {
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobLog = Omit<JobLogRow, "timestamp"> & {
  timestamp: string;
};

export type JobStats = Record<JobState, number>;

export interface BulkRerunResult {
  jobId: string;
  success: boolean;
  newJobId?: string;
  error?: string;
}
