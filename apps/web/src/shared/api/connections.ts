/** The Connections API's wire types (`server/api/connections`, issue #1 M3); naming in `./common.ts`. */
import type { McpCallResult, McpTransportKind } from "@tiny-agents/agent";
import type { Jsonified } from "../json";

export type ConnectionStatus = "connecting" | "connected" | "error" | "needs_auth";

/** One of a connection's tools, from its last listing, including those turned off. */
export interface ConnectionTool {
  /** As bots see it: `mcp__<slug>__<tool>`. */
  name: string;
  /** As the server names it; the id in tool routes. */
  serverName: string;
  label: string;
  description: string;
  readOnly: boolean;
  /** Off: no bot gets the tool, whatever its own permissions say. */
  enabled: boolean;
}

/** A connection as the routes return it (`connections.service.ts`). Secrets never leave. */
export interface ConnectionData {
  id: string;
  name: string;
  slug: string;
  url: string;
  transport: string;
  authType: string;
  headerName: string | null;
  hasSecret: boolean;
  /** Vault handle the header value is read from, when set. */
  secretRef: string | null;
  tools: ConnectionTool[];
  botIds: string[];
  status: ConnectionStatus;
  error?: string;
  createdAt: Date;
}

export type Connection = Jsonified<ConnectionData>;

/** What the bot editor lists of a connection. */
export type ConnectionSummary = Pick<Connection, "id" | "name" | "status"> & {
  toolCount: number;
};

/** One tool with everything the server declared about it. */
export interface ConnectionToolDetail extends ConnectionTool {
  idempotent: boolean;
  destructive: boolean;
  openWorld: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  connection: Pick<Connection, "id" | "name" | "slug" | "status">;
}

/** `POST /connections/:id/tools/:tool/call`: the playground's call. */
export interface ToolCallResult {
  result: McpCallResult;
  durationMs: number;
}

/** `POST /connections/test`: the transport that worked and the tools it listed. */
export interface ConnectionTestResult {
  transport: McpTransportKind;
  /** `name` as the server names the tool. */
  tools: (Pick<ConnectionTool, "label" | "description" | "readOnly"> & { name: string })[];
}

/** `POST /connections/:id/authorize`: the consent URL, absent when already authorized. */
export interface ConnectionAuthorization {
  authorizationUrl?: string;
}

type Transport = "streamable-http" | "sse";

/** `POST /connections` (step-up). */
export interface ConnectionCreateBody {
  name: string;
  url: string;
  transport?: Transport;
  authType?: "none" | "header" | "oauth";
  headerName?: string;
  secret?: string;
  /** Pre-registered OAuth client, for servers without automatic registration. */
  clientId?: string;
  clientSecret?: string;
  botIds?: string[];
}

/** `PATCH /connections/:id`: a URL, header or secret change needs step-up. */
export interface ConnectionUpdateBody {
  name?: string;
  url?: string;
  headerName?: string;
  /** Replaces the stored header value (and drops a vault reference). */
  secret?: string;
  /** Vault handle holding the header value (issue #56); null goes back to the stored value. */
  secretRef?: string | null;
  botIds?: string[];
}

/** `POST /connections/test`. */
export interface ConnectionTestBody {
  url: string;
  transport?: Transport;
  headerName?: string;
  secret?: string;
}

/** `PATCH /connections/:id/tools/:tool`. */
export interface ConnectionToolUpdateBody {
  enabled: boolean;
}

/** `POST /connections/:id/tools/:tool/call`. */
export interface ConnectionToolCallBody {
  arguments?: Record<string, unknown>;
}
