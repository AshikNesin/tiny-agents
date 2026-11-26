import { Type } from "typebox";
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

export type McpToolInfo = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
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
  onToolsChanged?: (tools: McpToolInfo[]) => void;
  onClose?: () => void;
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

export const MCP_LIST_PAGES_MAX = 50;
export const MCP_LIST_TOOLS_MAX = 500;

async function listAllTools(client: Client): Promise<McpToolInfo[]> {
  const tools: McpToolInfo[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MCP_LIST_PAGES_MAX && tools.length < MCP_LIST_TOOLS_MAX; page++) {
    const listed = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...listed.tools.slice(0, MCP_LIST_TOOLS_MAX - tools.length).map(toToolInfo));
    cursor = listed.nextCursor;
    if (!cursor) break;
  }
  return tools;
}

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

export const MCP_DEFER_CHARS = 8_000;

const MCP_DESCRIPTION_MAX = 2_048;

function clipDescription(text: string): string {
  return text.length <= MCP_DESCRIPTION_MAX ? text : `${text.slice(0, MCP_DESCRIPTION_MAX - 1)}…`;
}

const MCP_TOOL_NAME_MAX = 64;
const MCP_NAME_SUFFIX = 7;

function hashName(name: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(MCP_NAME_SUFFIX, "0").slice(-MCP_NAME_SUFFIX);
}

export function mcpToolName(slug: string, tool: string): string {
  const full = `mcp__${slug}__${tool}`;
  const name = full.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (name.length <= MCP_TOOL_NAME_MAX && name === full) return name;
  const cut = name.slice(0, MCP_TOOL_NAME_MAX - MCP_NAME_SUFFIX - 1);
  return `${cut}_${hashName(full)}`;
}

export interface McpCapabilityOptions {
  slug: string;
  name: string;
  url: string;
  tools: McpToolInfo[];
  call: (
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<McpCallResult>;
  setupHint?: string;
  shared?: boolean;
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
  const sent = options.tools.map((tool) => ({
    tool,
    name: mcpToolName(options.slug, tool.name),
    description: clipDescription(tool.description ?? tool.title ?? tool.name),
    schema:
      tool.inputSchema && typeof tool.inputSchema === "object"
        ? tool.inputSchema
        : { type: "object" },
  }));
  const size = sent.reduce(
    (sum, { name, description, schema }) =>
      sum + name.length + description.length + JSON.stringify(schema).length,
    0,
  );
  const defer = options.shared === true || size > MCP_DEFER_CHARS;
  const tools = sent.map(({ tool, name, description, schema }) =>
    defineTool({
      name,
      description,
      parameters: Type.Unsafe<Record<string, unknown>>(schema),
      ...(defer ? { deferred: true } : {}),
      replay: "unsafe",
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
    })),
    ...(options.setupHint ? { setupHint: options.setupHint } : {}),
    ...(options.shared ? { shared: true } : {}),
  };
}
