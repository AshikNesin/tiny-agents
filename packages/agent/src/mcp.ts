/**
 * Remote MCP servers as capabilities (issue #1 D8–D14).
 *
 * - `connectMcp` opens an MCP client over Streamable HTTP, falling back to
 *   legacy HTTP+SSE (remote transports only: the app never spawns local
 *   servers), optionally signed in through an OAuth provider (the MCP SDK runs
 *   discovery, PKCE, registration and refresh).
 * - `createMcpCapability` turns a server's tool list into a pi-durable
 *   extension named `mcp:<slug>`, tools `mcp__<slug>__<tool>`. Tools are
 *   `replay: "unsafe"` unless the server marks them read-only or idempotent,
 *   so an interrupted call is reported, not repeated.
 */
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import type { Capability } from "./capabilities";

export { auth as mcpAuth } from "@modelcontextprotocol/sdk/client/auth.js";
export type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
export type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export type McpTransportKind = "streamable-http" | "sse";

/** A server tool as cached by the app (enough to rebuild the capability offline). */
export type McpToolInfo = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /** JSON Schema of `structuredContent`, when the server declares one. */
  outputSchema?: Record<string, unknown>;
  readOnly?: boolean;
  idempotent?: boolean;
  destructive?: boolean;
  openWorld?: boolean;
};

export type McpCallResult = {
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export interface McpConnection {
  transport: McpTransportKind;
  tools: McpToolInfo[];
  call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>;
  close(): Promise<void>;
}

export interface ConnectMcpOptions {
  url: string;
  transport: McpTransportKind;
  headers?: Record<string, string>;
  authProvider?: OAuthClientProvider;
  /** The server changed its tool list (`notifications/tools/list_changed`). */
  onToolsChanged?: (tools: McpToolInfo[]) => void;
  /** The connection closed (server went away, network error). */
  onClose?: () => void;
  /** Transport override for tests (e.g. an in-memory pair). */
  createTransport?: () => Transport;
}

function toToolInfo(tool: McpTool): McpToolInfo {
  return {
    name: tool.name,
    ...(tool.title || tool.annotations?.title
      ? { title: tool.title ?? tool.annotations?.title }
      : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema as Record<string, unknown>,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema as Record<string, unknown> } : {}),
    ...(tool.annotations?.readOnlyHint ? { readOnly: true } : {}),
    ...(tool.annotations?.idempotentHint ? { idempotent: true } : {}),
    ...(tool.annotations?.destructiveHint ? { destructive: true } : {}),
    ...(tool.annotations?.openWorldHint ? { openWorld: true } : {}),
  };
}

async function listAllTools(client: Client): Promise<McpToolInfo[]> {
  const tools: McpToolInfo[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools.map(toToolInfo));
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

/**
 * Connect, initialize and list tools. Throws the SDK's `UnauthorizedError`
 * when the server needs (re)authorization: the provider's
 * `redirectToAuthorization` has then been called with the consent URL.
 */
export async function connectMcp(options: ConnectMcpOptions): Promise<McpConnection> {
  const attempt = async (kind: McpTransportKind): Promise<McpConnection> => {
    const client = new Client(
      { name: "tiny-agents", version: "1.0.0" },
      {
        listChanged: {
          tools: {
            onChanged: (error, tools) => {
              if (!error && tools) options.onToolsChanged?.(tools.map(toToolInfo));
            },
          },
        },
      },
    );
    const requestInit = options.headers ? { headers: options.headers } : undefined;
    const transport =
      options.createTransport?.() ??
      (kind === "sse"
        ? new SSEClientTransport(new URL(options.url), {
            authProvider: options.authProvider,
            requestInit,
          })
        : new StreamableHTTPClientTransport(new URL(options.url), {
            authProvider: options.authProvider,
            requestInit,
          }));
    await client.connect(transport);
    client.onclose = () => options.onClose?.();
    const tools = await listAllTools(client);
    return {
      transport: kind,
      tools,
      call: async (tool, args, signal) =>
        (await client.callTool({ name: tool, arguments: args }, undefined, {
          signal,
          timeout: 120_000,
        })) as McpCallResult,
      close: async () => {
        client.onclose = undefined;
        await client.close();
      },
    };
  };
  try {
    return await attempt(options.transport);
  } catch (error) {
    // Legacy servers speak HTTP+SSE only; auth errors are not a transport problem.
    if (options.transport === "sse" || options.createTransport || isUnauthorized(error))
      throw error;
    return attempt("sse");
  }
}

export function isUnauthorized(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "UnauthorizedError" || /\b401\b|unauthori[sz]ed/i.test(error.message))
  );
}

/** Above this many tools, a server's tools are deferred behind `tool_search`. */
export const MCP_DEFER_THRESHOLD = 30;

/** `mcp__<slug>__<tool>`, restricted to provider-safe characters and 64 chars. */
export function mcpToolName(slug: string, tool: string): string {
  const name = `mcp__${slug}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return name.length <= 64 ? name : name.slice(0, 64);
}

export interface McpCapabilityOptions {
  slug: string;
  name: string;
  url: string;
  tools: McpToolInfo[];
  /** Call a tool on the live connection (the app reconnects as needed). */
  call: (
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<McpCallResult>;
  setupHint?: string;
}

function resultOf(result: McpCallResult): ToolExecutionResult {
  const output: NonNullable<ToolExecutionResult["output"]> = [];
  for (const block of result.content ?? []) {
    if (block.type === "text" && block.text !== undefined)
      output.push({ type: "text", text: block.text });
    else if (block.type === "image" && block.data && block.mimeType) {
      output.push({ type: "image", data: block.data, mimeType: block.mimeType });
    } else output.push({ type: "text", text: JSON.stringify(block) });
  }
  return { output, ...(result.isError ? { isError: true } : {}) };
}

export function createMcpCapability(options: McpCapabilityOptions): Capability {
  const id = `mcp:${options.slug}`;
  const defer = options.tools.length > MCP_DEFER_THRESHOLD;
  const tools = options.tools.map((tool) =>
    defineTool({
      name: mcpToolName(options.slug, tool.name),
      description: tool.description ?? tool.title ?? tool.name,
      parameters: Type.Unsafe<Record<string, unknown>>(
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? tool.inputSchema
          : { type: "object" },
      ),
      // Large servers: hidden until the model finds them with tool_search.
      ...(defer ? { deferred: true } : {}),
      replay: tool.readOnly || tool.idempotent ? "safe" : "unsafe",
      execute: async (args, _api, context) => {
        try {
          return resultOf(await options.call(tool.name, args, context.abortSignal));
        } catch (error) {
          if (context.abortSignal?.aborted) throw error;
          return {
            output: [
              {
                type: "text",
                text: `${options.name}: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    }),
  );
  return {
    id,
    kind: "connection",
    name: options.name,
    description: options.url,
    extension: defineExtension({ name: id, tools }),
    tools: options.tools.map((tool) => ({
      name: mcpToolName(options.slug, tool.name),
      label: tool.title ?? tool.name,
      description: tool.description ?? "",
      ...(tool.readOnly ? { readOnly: true } : {}),
    })),
    ...(options.setupHint ? { setupHint: options.setupHint } : {}),
  };
}
