/** Typed client for the connections API (issue #1 M3). */
import { apiClient } from "@groot/shell/lib/api";

export type ConnectionStatus = "connecting" | "connected" | "error" | "needs_auth";

interface ConnectionTool {
  /** As bots see it: `mcp__<slug>__<tool>`. */
  name: string;
  /** As the server names it; the id in tool URLs. */
  serverName: string;
  label: string;
  description: string;
  readOnly: boolean;
  /** Off: no bot gets the tool. */
  enabled: boolean;
}

export interface ConnectionToolDetail extends ConnectionTool {
  idempotent: boolean;
  destructive: boolean;
  openWorld: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  connection: Pick<Connection, "id" | "name" | "slug" | "status">;
}

export interface ToolCallResult {
  result: {
    content: { type: string; text?: string; data?: string; mimeType?: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  durationMs: number;
}

export interface Connection {
  id: string;
  name: string;
  slug: string;
  url: string;
  transport: string;
  authType: string;
  headerName: string | null;
  hasSecret: boolean;
  tools: ConnectionTool[];
  botIds: string[];
  status: ConnectionStatus;
  error?: string;
  createdAt: string;
}

export type ConnectionSummary = Pick<Connection, "id" | "name" | "status"> & {
  toolCount: number;
};

export interface TestResult {
  transport: string;
  tools: Pick<ConnectionTool, "label" | "description" | "readOnly">[];
}

export const connectionsApi = {
  list: () => apiClient.get<Connection[]>("/connections"),
  get: (id: string) => apiClient.get<Connection>(`/connections/${id}`),
  create: (input: {
    name: string;
    url: string;
    transport?: string;
    authType?: "none" | "header" | "oauth";
    headerName?: string;
    secret?: string;
    clientId?: string;
    clientSecret?: string;
    botIds?: string[];
  }) => apiClient.post<Connection>("/connections", input),
  update: (
    id: string,
    input: { name?: string; url?: string; headerName?: string; secret?: string; botIds?: string[] },
  ) => apiClient.patch<Connection>(`/connections/${id}`, input),
  remove: (id: string) => apiClient.delete(`/connections/${id}`),
  reconnect: (id: string) => apiClient.post<Connection>(`/connections/${id}/reconnect`),
  authorize: (id: string) =>
    apiClient.post<{ authorizationUrl?: string }>(`/connections/${id}/authorize`),
  getTool: (id: string, tool: string) =>
    apiClient.get<ConnectionToolDetail>(`/connections/${id}/tools/${encodeURIComponent(tool)}`),
  updateTool: (id: string, tool: string, input: { enabled: boolean }) =>
    apiClient.patch<ConnectionToolDetail>(
      `/connections/${id}/tools/${encodeURIComponent(tool)}`,
      input,
    ),
  callTool: (id: string, tool: string, args: Record<string, unknown>) =>
    apiClient.post<ToolCallResult>(`/connections/${id}/tools/${encodeURIComponent(tool)}/call`, {
      arguments: args,
    }),
  test: (input: { url: string; transport?: string; headerName?: string; secret?: string }) =>
    apiClient.post<TestResult>("/connections/test", input),
};
