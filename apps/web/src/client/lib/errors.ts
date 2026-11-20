import { ApiError } from "@groot/shell/lib/api";

export const OFFLINE_MESSAGE = "You're offline or the server can't be reached. Try again.";
export const TIMEOUT_MESSAGE = "The server took too long to answer. Try again.";

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

export function serverMessage(error: ApiError): string | undefined {
  if (!error.message) return undefined;
  if (error.fromServer || error.code !== `HTTP_${error.status}`) return error.message;
  return undefined;
}

const NETWORK_FAILURE = /failed to fetch|fetch failed|load failed|networkerror|network connection/i;

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && NETWORK_FAILURE.test(error.message);
}

function isTimeout(error: unknown): boolean {
  return (
    !!error && typeof error === "object" && (error as { name?: unknown }).name === "TimeoutError"
  );
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const detail = firstDetail(error.details);
    if (detail) return detail;
    return serverMessage(error) ?? fallback;
  }
  if (isTimeout(error)) return TIMEOUT_MESSAGE;
  if (isNetworkFailure(error)) return OFFLINE_MESSAGE;
  return error instanceof Error && error.message ? error.message : fallback;
}
