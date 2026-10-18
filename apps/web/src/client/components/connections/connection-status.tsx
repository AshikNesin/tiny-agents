import { StatusBadge } from "@groot/ui/status-badge";
import type { Connection, ConnectionStatus } from "../../lib/connections-api";

const STATUS_BADGE: Record<ConnectionStatus, { variant: string; label: string }> = {
  connected: { variant: "success", label: "Connected" },
  connecting: { variant: "pending", label: "Connecting" },
  error: { variant: "error", label: "Error" },
  needs_auth: { variant: "warning", label: "Needs sign-in" },
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  return <StatusBadge status={STATUS_BADGE[status].variant} label={STATUS_BADGE[status].label} />;
}

export function needsAttention(status: ConnectionStatus): boolean {
  return status === "needs_auth" || status === "error";
}

export function authDescription(connection: Pick<Connection, "authType" | "headerName">): string {
  if (connection.authType === "header") {
    return `API key header (${connection.headerName ?? "x-api-key"})`;
  }
  if (connection.authType === "oauth") return "Sign in (OAuth)";
  return "No authentication";
}

export function openOAuthPopup(url: string): boolean {
  const popup = window.open(
    url,
    "tiny-agents-oauth",
    "popup=yes,width=640,height=720,scrollbars=yes",
  );
  return popup !== null;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { data?: { error?: { message?: string } } } }).response;
    const message = response?.data?.error?.message;
    if (message) return message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
