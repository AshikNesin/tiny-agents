/**
 * A small structured logger with a pino-shaped API: `logger.info(data, msg)`,
 * `logger.child(bindings)`, level filtering. JSON lines in production (what
 * Workers Logs and most log shippers expect), a readable single line in dev.
 */

import { scrubText, scrubValue } from "./scrub";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

const LEVEL_VALUE: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY,
};

export type LogData = Record<string, unknown>;

export interface LogFn {
  (message: string): void;
  (data: LogData | Error, message?: string): void;
}

export interface Logger {
  readonly bindings: LogData;
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child(bindings: LogData): Logger;
}

export interface LoggerSettings {
  level: LogLevel;
  /** Human-readable output instead of JSON lines. */
  pretty: boolean;
  /** Fields added to every record (service name, env, ...). */
  base: LogData;
  /** Where lines go. Defaults to the console, mapped by level. */
  write: (level: LogLevel, line: string, record: LogRecord) => void;
}

export interface LogRecord extends LogData {
  level: LogLevel;
  time: string;
  msg: string;
}

const settings: LoggerSettings = {
  level: "info",
  pretty: false,
  base: {},
  write: writeToConsole,
};

export function configureLogger(next: Partial<LoggerSettings>): void {
  Object.assign(settings, next);
}

export function getLoggerSettings(): Readonly<LoggerSettings> {
  return settings;
}

export function isLevelEnabled(level: LogLevel): boolean {
  return LEVEL_VALUE[level] >= LEVEL_VALUE[settings.level];
}

export function serializeError(error: Error): LogData {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error.cause !== undefined ? { cause: String(error.cause) } : {}),
  };
}

function normalize(data: LogData): LogData {
  const out: LogData = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

function writeToConsole(level: LogLevel, line: string): void {
  if (level === "error" || level === "fatal") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

const COLORS: Record<string, string> = {
  trace: "\u001b[90m",
  debug: "\u001b[36m",
  info: "\u001b[32m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
  fatal: "\u001b[35m",
  reset: "\u001b[0m",
  dim: "\u001b[2m",
};

function formatPretty(record: LogRecord): string {
  const { level, time, msg, ...rest } = record;
  for (const key of Object.keys(settings.base)) delete rest[key];
  const extras =
    Object.keys(rest).length > 0 ? ` ${COLORS.dim}${JSON.stringify(rest)}${COLORS.reset}` : "";
  const clock = time.slice(11, 19);
  return `${COLORS.dim}${clock}${COLORS.reset} ${COLORS[level]}${level.toUpperCase().padEnd(5)}${COLORS.reset} ${msg}${extras}`;
}

function emit(
  level: LogLevel,
  bindings: LogData,
  args: [string] | [LogData | Error, string?],
): void {
  if (!isLevelEnabled(level)) return;

  let data: LogData = {};
  let msg: string;
  if (typeof args[0] === "string") {
    msg = args[0];
  } else if (args[0] instanceof Error) {
    data = { err: args[0] };
    msg = args[1] ?? args[0].message;
  } else {
    data = args[0];
    msg = args[1] ?? "";
  }

  const record: LogRecord = {
    level,
    time: new Date().toISOString(),
    ...settings.base,
    ...bindings,
    // Every field and the message pass through the app's scrubber (vault
    // secrets) before they are written; see ./scrub.
    ...scrubValue(normalize(data)),
    msg: scrubText(msg),
  };
  settings.write(level, settings.pretty ? formatPretty(record) : JSON.stringify(record), record);
}

export function createLogger(bindings: LogData = {}): Logger {
  const level = (name: LogLevel): LogFn =>
    ((...args: [string] | [LogData | Error, string?]) => emit(name, bindings, args)) as LogFn;
  return {
    bindings,
    trace: level("trace"),
    debug: level("debug"),
    info: level("info"),
    warn: level("warn"),
    error: level("error"),
    fatal: level("fatal"),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

/** The root logger. Child loggers inherit the settings applied via `configureLogger`. */
export const logger: Logger = createLogger();
