/**
 * What to tell the owner when a request fails. The client's own wording (an
 * HTTP status line such as "Conflict", fetch's "Failed to fetch") says
 * nothing useful, while the server's `{ error: { message, details } }`
 * envelope, carried by `ApiError`, usually says exactly what went wrong, so
 * prefer it: the first field-level validation message, then the error
 * message, then plain words for a request that never got an answer, and the
 * caller's fallback last.
 */
import { ApiError } from "@groot/shell/lib/api";

export const OFFLINE_MESSAGE = "You're offline or the server can't be reached. Try again.";
export const TIMEOUT_MESSAGE = "The server took too long to answer. Try again.";

/** The first message in a validation `details` map (`{ field: ["msg"] }`). */
function firstDetail(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  for (const value of Object.values(details as Record<string, unknown>)) {
    if (typeof value === "string" && value) return value;
    if (Array.isArray(value)) {
      const first = value.find((item): item is string => typeof item === "string" && !!item);
      if (first) return first;
    }
  }
  return undefined;
}

/**
 * The server's own error message, or undefined when the response carried no
 * envelope (a proxy's HTML page, an empty body): `ApiError` then falls back
 * to the status line and an `HTTP_<status>` code.
 */
export function serverMessage(error: ApiError): string | undefined {
  if (error.code === `HTTP_${error.status}`) return undefined;
  return error.message || undefined;
}

/** fetch rejects with a TypeError when the request never got an answer. */
const NETWORK_FAILURE = /failed to fetch|fetch failed|load failed|networkerror|network connection/i;

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && NETWORK_FAILURE.test(error.message);
}

/** An aborted-by-timeout request (`AbortSignal.timeout`). */
function isTimeout(error: unknown): boolean {
  return (
    !!error && typeof error === "object" && (error as { name?: unknown }).name === "TimeoutError"
  );
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const detail = firstDetail(error.details);
    if (detail) return detail;
    // Without the server's envelope there is only the status line, never worth showing.
    return serverMessage(error) ?? fallback;
  }
  if (isTimeout(error)) return TIMEOUT_MESSAGE;
  if (isNetworkFailure(error)) return OFFLINE_MESSAGE;
  return error instanceof Error && error.message ? error.message : fallback;
}
