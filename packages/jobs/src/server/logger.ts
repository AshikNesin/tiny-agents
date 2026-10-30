import {
  logger,
  serializeError,
  type LogData,
  type LogFn,
  type LogLevel,
  type Logger,
} from "@groot/core/logger";
import { db } from "@groot/core/database";
import { jobLogs } from "./schema";

/**
 * A job logger writes to the normal log stream and persists `info` and above
 * to `job_logs` so the dashboard can show a per-job trail. Writes are tracked
 * so the tick can `flushJobLogs()` before it marks the job done.
 */
export interface CreateJobLoggerOptions {
  jobId: string;
  jobName: string;
  additionalContext?: LogData;
}

const PERSISTED_LEVELS = new Set<LogLevel>(["info", "warn", "error", "fatal"]);
const pending = new Set<Promise<unknown>>();

function persist(jobId: string, jobName: string, level: LogLevel, message: string, data: LogData) {
  const write = db
    .insert(jobLogs)
    .values({
      jobId,
      jobName,
      level,
      message,
      data: Object.keys(data).length > 0 ? data : null,
      timestamp: new Date(),
    })
    .then(() => undefined)
    .catch((error: unknown) => logger.error({ err: error, jobId }, "Failed to persist job log"));
  pending.add(write);
  void write.finally(() => pending.delete(write));
}

function splitArgs(args: [string] | [LogData | Error, string?]): {
  message: string;
  data: LogData;
} {
  if (typeof args[0] === "string") return { message: args[0], data: {} };
  if (args[0] instanceof Error) {
    return { message: args[1] ?? args[0].message, data: { err: serializeError(args[0]) } };
  }
  const data: LogData = {};
  for (const [key, value] of Object.entries(args[0])) {
    data[key] = value instanceof Error ? serializeError(value) : value;
  }
  return { message: args[1] ?? "", data };
}

export function createJobLogger(options: CreateJobLoggerOptions): Logger {
  const { jobId, jobName, additionalContext = {} } = options;
  const base = logger.child({ jobId, jobName, ...additionalContext });

  const level = (name: LogLevel): LogFn =>
    ((...args: [string] | [LogData | Error, string?]) => {
      (base[name as Exclude<LogLevel, "silent">] as LogFn)(...(args as [string]));
      if (PERSISTED_LEVELS.has(name)) {
        const { message, data } = splitArgs(args);
        persist(jobId, jobName, name, message, data);
      }
    }) as LogFn;

  return {
    bindings: base.bindings,
    trace: level("trace"),
    debug: level("debug"),
    info: level("info"),
    warn: level("warn"),
    error: level("error"),
    fatal: level("fatal"),
    child: (extra) =>
      createJobLogger({ jobId, jobName, additionalContext: { ...additionalContext, ...extra } }),
  };
}

/** Wait for every in-flight `job_logs` write. */
export async function flushJobLogs(): Promise<void> {
  await Promise.allSettled(pending);
}
