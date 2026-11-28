import type { Connection, ConnectionStatus } from "../../../shared/api/connections";
import type { StatusLabels } from "../../../shared/machines/status-label";
import { MachineStatusBadge } from "../MachineStatusBadge";

const CONNECTION_STATUS_LABELS: StatusLabels<ConnectionStatus> = {
  connected: { label: "Connected", tone: "success" },
  connecting: { label: "Connecting", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
  needs_auth: { label: "Needs sign-in", tone: "warning" },
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  return <MachineStatusBadge status={status} labels={CONNECTION_STATUS_LABELS} />;
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

export { errorMessage } from "../../lib/errors";
