import type { McpCallResult, McpTransportKind } from "@tiny-agents/agent";
import type { Jsonified } from "../json";

export type ConnectionStatus = "connecting" | "connected" | "error" | "needs_auth";

export interface ConnectionTool {
  name: string;
  serverName: string;
  label: string;
  description: string;
  readOnly: boolean;
  enabled: boolean;
}

export interface ConnectionData {
  id: string;
  name: string;
  slug: string;
  url: string;
  transport: string;
  authType: string;
  headerName: string | null;
  hasSecret: boolean;
  secretRef: string | null;
  tools: ConnectionTool[];
  allBots: boolean;
  botIds: string[];
  status: ConnectionStatus;
  error?: string;
  createdAt: Date;
}

export type Connection = Jsonified<ConnectionData>;

export type ConnectionSummary = Pick<Connection, "id" | "name" | "status"> & {
  toolCount: number;
};

export interface ConnectionToolDetail extends ConnectionTool {
  idempotent: boolean;
  destructive: boolean;
  openWorld: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  connection: Pick<Connection, "id" | "name" | "slug" | "status">;
}

export interface ToolCallResult {
  result: McpCallResult;
  durationMs: number;
}

export interface ConnectionTestResult {
  transport: McpTransportKind;
  tools: (Pick<ConnectionTool, "label" | "description" | "readOnly"> & { name: string })[];
}

export interface ConnectionAuthorization {
  authorizationUrl?: string;
}

type Transport = "streamable-http" | "sse";

export interface ConnectionCreateBody {
  name: string;
  url: string;
  transport?: Transport;
  authType?: "none" | "header" | "oauth";
  headerName?: string;
  secret?: string;
  clientId?: string;
  clientSecret?: string;
  allBots?: boolean;
  botIds?: string[];
}

export interface ConnectionUpdateBody {
  name?: string;
  url?: string;
  headerName?: string;
  secret?: string;
  secretRef?: string | null;
  allBots?: boolean;
  botIds?: string[];
}

export interface ConnectionTestBody {
  url: string;
  transport?: Transport;
  headerName?: string;
  secret?: string;
}

export interface ConnectionToolUpdateBody {
  enabled: boolean;
}

export interface ConnectionToolCallBody {
  arguments?: Record<string, unknown>;
}
