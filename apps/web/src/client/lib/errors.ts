/**
 * What to tell the owner when a request fails. Axios's own messages ("Request
 * failed with status code 400", "Network Error") say nothing useful, while the
 * server's `{ error: { message, details } }` envelope usually says exactly
 * what went wrong, so prefer it: the first field-level validation message,
 * then the error message, then plain words for a request that never got an
 * answer, and the caller's fallback last.
 */
interface ErrorEnvelope {
  error?: { message?: string; details?: unknown };
}

interface RequestFailure {
  response?: { data?: ErrorEnvelope };
  request?: unknown;
  code?: string;
  isAxiosError?: boolean;
}

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

export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const failure = error as RequestFailure;
    const envelope = failure.response?.data?.error;
    const detail = firstDetail(envelope?.details);
    if (detail) return detail;
    if (envelope?.message) return envelope.message;
    if (failure.isAxiosError && !failure.response) {
      if (failure.code === "ECONNABORTED" || failure.code === "ETIMEDOUT") return TIMEOUT_MESSAGE;
      return OFFLINE_MESSAGE;
    }
    // Axios's status-line text is never worth showing on its own.
    if (failure.isAxiosError) return fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
