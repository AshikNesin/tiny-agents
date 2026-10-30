import { logger, type Logger } from "./core";

export interface RequestDescriptor {
  requestId: string;
  method: string;
  url: string;
  userAgent?: string;
  ip?: string;
}

export function createRequestLogger(
  request: RequestDescriptor,
  additionalContext: Record<string, unknown> = {},
): Logger {
  return logger.child({
    reqId: request.requestId,
    method: request.method,
    url: request.url,
    userAgent: request.userAgent,
    ip: request.ip,
    ...additionalContext,
  });
}

export interface LogBusinessEventOptions {
  event: string;
  data: Record<string, unknown>;
  level?: "info" | "warn" | "error";
}

/** Domain events worth finding later (`type: "business_event"`). */
export function logBusinessEvent(options: LogBusinessEventOptions): void {
  const { event, data, level = "info" } = options;
  logger[level]({ type: "business_event", event, ...data }, `Business event: ${event}`);
}

export interface LogPerformanceOptions {
  operation: string;
  duration: number;
  data?: Record<string, unknown>;
}

/** Timing record (`type: "performance"`); escalates to warn past 5s. */
export function logPerformance(options: LogPerformanceOptions): void {
  const { operation, duration, data = {} } = options;
  const level = duration > 5000 ? "warn" : duration > 1000 ? "info" : "debug";
  logger[level](
    { type: "performance", operation, duration: `${duration}ms`, ...data },
    `Performance: ${operation} completed in ${duration}ms`,
  );
}
