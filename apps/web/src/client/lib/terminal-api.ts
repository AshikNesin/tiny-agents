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
  create: (size?: { cols?: number; rows?: number }, run?: "claude-login") =>
    apiClient.post<TerminalSession>("/terminal/sessions", {
      ...size,
      ...(run ? { run } : {}),
    } satisfies TerminalCreateBody),
  remove: (name: string, force = false) =>
    apiClient.delete<Deleted>(`/terminal/sessions/${name}${force ? "?force=1" : ""}`),
  ticket: (name: string) => apiClient.post<TerminalTicket>(`/terminal/sessions/${name}/ticket`),
};

export function closeBlockedReason(error: unknown): TerminalCloseBlocked | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status !== 409) return null;
  const message = serverMessage(error);
  if (!message) return null;
  const details = error.details as { process?: unknown } | undefined;
  const processName = typeof details?.process === "string" ? details.process : undefined;
  return { message, process: processName };
}
