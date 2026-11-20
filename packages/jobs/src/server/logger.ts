import {
  getLoggerSettings,
  logger,
  type LogData,
  type Logger,
  type LogRecord,
} from "@groot/core/logger";
import { inArray } from "drizzle-orm";
import { db } from "@groot/core/database";
import { jobLogs } from "./schema";

export interface CreateJobLoggerOptions {
  jobId: string;
  jobName: string;
  additionalContext?: LogData;
}

const PERSISTED_LEVELS = new Set<string>(["info", "warn", "error", "fatal"]);
const pending = new Set<Promise<unknown>>();

function persistSink(jobId: string, jobName: string): (record: LogRecord) => void {
  return (record) => {
    if (!PERSISTED_LEVELS.has(record.level)) return;
    const { level, msg, time, jobId: _jobId, jobName: _jobName, ...rest } = record;
    const base = getLoggerSettings().base;
    const data: LogData = {};
    for (const [key, value] of Object.entries(rest)) {
      if (!(key in base)) data[key] = value;
    }
    const write = db
      .insert(jobLogs)
      .values({
        jobId,
        jobName,
        level,
        message: msg,
        data: Object.keys(data).length > 0 ? data : null,
        timestamp: new Date(time),
      })
      .then(() => undefined)
      .catch((error: unknown) => logger.error({ err: error, jobId }, "Failed to persist job log"));
    pending.add(write);
    void write.finally(() => pending.delete(write));
  };
}

export function createJobLogger(options: CreateJobLoggerOptions): Logger {
  const { jobId, jobName, additionalContext = {} } = options;
  return logger.child(
    { jobId, jobName, ...additionalContext },
    { sink: persistSink(jobId, jobName) },
  );
}

const DELETE_CHUNK_SIZE = 90;

export async function deleteJobLogs(jobIds: readonly string[]): Promise<void> {
  for (let start = 0; start < jobIds.length; start += DELETE_CHUNK_SIZE) {
    const chunk = jobIds.slice(start, start + DELETE_CHUNK_SIZE);
    await db.delete(jobLogs).where(inArray(jobLogs.jobId, chunk));
  }
}

export async function flushJobLogs(): Promise<void> {
  await Promise.allSettled(pending);
}
