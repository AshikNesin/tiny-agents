/**
 * Typed client for the terminal API (issue #28). Mirrors the server's
 * shapes; `apiClient` unwraps the { success, data } envelope. The 409
 * helper reads the error envelope the whole app's middleware emits
 * ({ success, error: { message, details } }).
 */
import { ApiError, apiClient } from "@groot/shell/lib/api";
import { serverMessage } from "./errors";

/** One tmux-backed tab on the sandbox VM. */
export interface TerminalSession {
  name: string;
  /** Foreground process (pane_current_command); null when idle at the shell. */
  process: string | null;
  /** A viewer is currently attached to this tab. */
  attached: boolean;
  createdAt: string;
}

/** Server availability: drives the page's setup/error/empty states. */
export type TerminalStatusWire =
  | { kind: "ready" }
  | { kind: "unconfigured" }
  | { kind: "unreachable"; message: string }
  | { kind: "tmux-missing"; installCommand: string };

/** GET /terminal/sessions answers availability and tabs in one dial. */
export interface TerminalList {
  status: TerminalStatusWire;
  sessions: TerminalSession[];
}

/**
 * Why a DELETE was refused: the tab's pane is running something besides the
 * login shell. `process` is the foreground process name when the server
 * sent it.
 */
export interface TerminalCloseBlocked {
  message: string;
  process?: string;
}

export const terminalApi = {
  list: () => apiClient.get<TerminalList>("/terminal/sessions"),
  /** `run` types a fixed command into the new tab (`claude-login` signs Claude Code in). */
  create: (size?: { cols?: number; rows?: number }, run?: "claude-login") =>
    apiClient.post<TerminalSession>("/terminal/sessions", { ...size, ...(run ? { run } : {}) }),
  remove: (name: string, force = false) =>
    apiClient.delete<{ deleted: boolean }>(`/terminal/sessions/${name}${force ? "?force=1" : ""}`),
  /** One-time WS ticket; `path` is same-origin, already carries the ticket. */
  ticket: (name: string) => apiClient.post<{ path: string }>(`/terminal/sessions/${name}/ticket`),
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
