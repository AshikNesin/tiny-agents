/** Typed client for the connections API (issue #1 M3). */
import { apiClient } from "@groot/shell/lib/api";

export type ConnectionStatus = "connecting" | "connected" | "error" | "needs_auth";

export interface ConnectionTool {
  name: string;
  label: string;
  description: string;
  readOnly: boolean;
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
  tools: Omit<ConnectionTool, "name">[];
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
  test: (input: { url: string; transport?: string; headerName?: string; secret?: string }) =>
    apiClient.post<TestResult>("/connections/test", input),
};
