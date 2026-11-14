/**
 * Typed client for the terminal API (issue #28). The shapes are the server's
 * (`shared/api/terminal.ts`); `apiClient` unwraps the { success, data } envelope. The 409
 * helper reads the error envelope the whole app's middleware emits
 * ({ success, error: { message, details } }).
 */
import { ApiError, apiClient } from "@groot/shell/lib/api";
import type { Deleted } from "../../shared/api/common";
import type {
  TerminalCloseBlocked,
  TerminalCreateBody,
  TerminalList,
  TerminalSession,
  TerminalTicket,
} from "../../shared/api/terminal";
import { serverMessage } from "./errors";

export const terminalApi = {
  list: () => apiClient.get<TerminalList>("/terminal/sessions"),
  /** `run` types a fixed command into the new tab (`claude-login` signs Claude Code in). */
  create: (size?: { cols?: number; rows?: number }, run?: "claude-login") =>
    apiClient.post<TerminalSession>("/terminal/sessions", {
      ...size,
      ...(run ? { run } : {}),
    } satisfies TerminalCreateBody),
  remove: (name: string, force = false) =>
    apiClient.delete<Deleted>(`/terminal/sessions/${name}${force ? "?force=1" : ""}`),
  /** One-time WS ticket; `path` is same-origin, already carries the ticket. */
  ticket: (name: string) => apiClient.post<TerminalTicket>(`/terminal/sessions/${name}/ticket`),
};

/**
 * Extract the "process is running" refusal from a DELETE failure, or null
 * for any other error (network, 404, unknown shape). The server may put the
 * process name either in error.details.process or inside the message.
 */
export function closeBlockedReason(error: unknown): TerminalCloseBlocked | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status !== 409) return null;
  const message = serverMessage(error);
  if (!message) return null;
  const details = error.details as { process?: unknown } | undefined;
  const processName = typeof details?.process === "string" ? details.process : undefined;
  return { message, process: processName };
}
