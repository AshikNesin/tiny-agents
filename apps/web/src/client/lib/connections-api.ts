/**
 * Typed client for the connections API (issue #1 M3); the shapes are
 * `shared/api/connections.ts`. Adding, re-pointing (URL, header, secret) and
 * deleting a connection carry the vault's step-up token (S4); the caller runs
 * them through `useStepUp().run`.
 */
import { apiClient } from "@groot/shell/lib/api";
import type { Deleted } from "../../shared/api/common";
import type {
  Connection,
  ConnectionAuthorization,
  ConnectionCreateBody,
  ConnectionTestBody,
  ConnectionTestResult,
  ConnectionToolCallBody,
  ConnectionToolDetail,
  ConnectionToolUpdateBody,
  ConnectionUpdateBody,
  ToolCallResult,
} from "../../shared/api/connections";
import { stepped } from "./vault-api";

export const connectionsApi = {
  list: () => apiClient.get<Connection[]>("/connections"),
  get: (id: string) => apiClient.get<Connection>(`/connections/${id}`),
  create: (input: ConnectionCreateBody) => stepped<Connection>("post", "/connections", input),
  update: (id: string, input: ConnectionUpdateBody) =>
    input.url !== undefined || input.headerName !== undefined || input.secret !== undefined
      ? stepped<Connection>("patch", `/connections/${id}`, input)
      : apiClient.patch<Connection>(`/connections/${id}`, input),
  remove: (id: string) => stepped<Deleted>("delete", `/connections/${id}`),
  reconnect: (id: string) => apiClient.post<Connection>(`/connections/${id}/reconnect`),
  authorize: (id: string) =>
    apiClient.post<ConnectionAuthorization>(`/connections/${id}/authorize`),
  getTool: (id: string, tool: string) =>
    apiClient.get<ConnectionToolDetail>(`/connections/${id}/tools/${encodeURIComponent(tool)}`),
  updateTool: (id: string, tool: string, input: ConnectionToolUpdateBody) =>
    apiClient.patch<ConnectionToolDetail>(
      `/connections/${id}/tools/${encodeURIComponent(tool)}`,
      input,
    ),
  callTool: (id: string, tool: string, args: Record<string, unknown>) =>
    apiClient.post<ToolCallResult>(`/connections/${id}/tools/${encodeURIComponent(tool)}/call`, {
      arguments: args,
    } satisfies ConnectionToolCallBody),
  test: (input: ConnectionTestBody) =>
    apiClient.post<ConnectionTestResult>("/connections/test", input),
};
