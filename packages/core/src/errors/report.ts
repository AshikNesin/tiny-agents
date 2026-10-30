/**
 * Error reporting seam. Core code calls `reportError`; the runtime entry
 * (Node or Workers) plugs in Sentry or anything else via `setErrorReporter`.
 * Without a reporter it is a no-op, which is the right default for tests.
 */
export type ErrorReporter = (error: unknown, context?: Record<string, unknown>) => void;

let reporter: ErrorReporter = () => undefined;

export function setErrorReporter(next: ErrorReporter): void {
  reporter = next;
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  try {
    reporter(error, context);
  } catch {
    // Reporting must never take the request down with it.
  }
}
