/**
 * Agent SDK adapter. `query` is injected so tests never load the real SDK
 * and CI never calls Anthropic. The options are the lockdown: no built-in
 * tools, no settings, no request relay, retries off.
 */
import { z } from "zod";
import { workerProcessEnv } from "./guards";
import { newToolUseId, type QueryContext, type QueryFactory } from "./sessions";
import { asRateLimitInfo, usagePauseReason } from "./usage";
import type { ImagePart, JsonSchema } from "./protocol";

export interface SdkToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ClaudeSdkModule {
  query: (args: {
    prompt: AsyncIterable<SdkUserMessage>;
    options: SdkQueryOptions;
  }) => AsyncIterable<SdkMessage>;
  tool: (
    name: string,
    description: string,
    shape: Record<string, z.ZodType>,
    handler: (args: Record<string, unknown>) => Promise<SdkToolResult>,
  ) => unknown;
  createSdkMcpServer: (opts: { name: string; version?: string; tools: unknown[] }) => unknown;
}

/** The slice of SDK options this worker is willing to set. No base URL. */
export interface SdkQueryOptions {
  model: string;
  resume?: string;
  systemPrompt?: string;
  tools: readonly string[];
  strictMcpConfig: true;
  settingSources: readonly string[];
  maxTurns: number;
  permissionMode: "dontAsk";
  allowedTools: string[];
  mcpServers: Record<string, unknown>;
  env: Record<string, string>;
  includePartialMessages: false;
}

export interface SdkUserMessage {
  type: "user";
  message: {
    role: "user";
    content:
      | string
      | Array<
          | { type: "text"; text: string }
          | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
        >;
  };
  parent_tool_use_id: null;
  session_id: string;
}

export interface SdkMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
  rate_limit_info?: unknown;
  is_error?: boolean;
  errors?: string[];
  result?: string;
}

const MCP_PREFIX = "mcp__tiny-agents__";

/**
 * Options passed to `query`. Built-in tools are empty. Settings are empty.
 * `ANTHROPIC_BASE_URL` is not a field and is stripped from `env`.
 */
export function buildSdkOptions(input: {
  model: string;
  system?: string;
  resume?: string;
  maxTurns: number;
  env: Record<string, string | undefined>;
  mcpServer: unknown;
  toolNames: readonly string[];
}): SdkQueryOptions {
  const env = workerProcessEnv(input.env);
  if ("ANTHROPIC_BASE_URL" in env) {
    throw new Error("Refusing to set ANTHROPIC_BASE_URL.");
  }
  return {
    model: input.model,
    ...(input.resume ? { resume: input.resume } : {}),
    ...(input.system ? { systemPrompt: input.system } : {}),
    tools: [],
    strictMcpConfig: true,
    settingSources: [],
    maxTurns: input.maxTurns,
    permissionMode: "dontAsk",
    allowedTools: input.toolNames.map((name) => `${MCP_PREFIX}${name}`),
    mcpServers: { "tiny-agents": input.mcpServer },
    env,
    includePartialMessages: false,
  };
}

function zodShape(schema: JsonSchema): Record<string, z.ZodType> {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(properties)) {
    const type =
      value && typeof value === "object" && "type" in value ? String(value.type) : "string";
    let field: z.ZodType =
      type === "number" || type === "integer"
        ? z.number()
        : type === "boolean"
          ? z.boolean()
          : type === "array"
            ? z.array(z.unknown())
            : type === "object"
              ? z.record(z.string(), z.unknown())
              : z.string();
    if (!required.has(key)) field = field.optional();
    shape[key] = field;
  }
  return shape;
}

function userContent(
  text: string,
  images: ImagePart[] | undefined,
): SdkUserMessage["message"]["content"] {
  if (!images?.length) return text;
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...images.map((image) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: image.mimeType, data: image.data },
    })),
  ];
}

export function createSdkQueryFactory(
  sdk: ClaudeSdkModule,
  env: Record<string, string | undefined> = process.env,
): QueryFactory {
  return async (ctx: QueryContext) => {
    let turnId = "";
    const tools = ctx.tools.map((spec) =>
      sdk.tool(spec.name, spec.description, zodShape(spec.inputSchema), async (args) => {
        const toolUseId = newToolUseId();
        const result = await ctx.callTool({
          turnId,
          toolUseId,
          name: spec.name,
          input: args,
        });
        return {
          content: [{ type: "text", text: result.content }],
          ...(result.isError ? { isError: true } : {}),
        };
      }),
    );
    const mcpServer = sdk.createSdkMcpServer({
      name: "tiny-agents",
      version: "0.1.0",
      tools,
    });
    const options = buildSdkOptions({
      model: ctx.model,
      system: ctx.system,
      resume: ctx.resume,
      maxTurns: ctx.maxTurns,
      env,
      mcpServer,
      toolNames: ctx.tools.map((spec) => spec.name),
    });
    const prompt = (async function* (): AsyncIterable<SdkUserMessage> {
      for await (const turn of ctx.turns) {
        if (ctx.signal.aborted) return;
        turnId = turn.turnId;
        yield {
          type: "user",
          message: { role: "user", content: userContent(turn.text, turn.images) },
          parent_tool_use_id: null,
          session_id: "",
        };
      }
    })();
    const stream = sdk.query({ prompt, options });
    let text = "";
    for await (const message of stream) {
      if (ctx.signal.aborted) return;
      if (message.type === "system" && message.session_id)
        ctx.setClaudeSessionId(message.session_id);
      if (message.type === "rate_limit_event" || message.rate_limit_info) {
        const reason = usagePauseReason(asRateLimitInfo(message.rate_limit_info));
        if (reason) {
          ctx.publish({ type: "usage_pause", turnId, reason });
          return;
        }
      }
      const blocks = message.message?.content ?? [];
      const chunk = blocks
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");
      if (chunk && message.type === "assistant") {
        text = chunk;
        ctx.publish({ type: "text", turnId, text });
      }
      if (message.type === "result") {
        if (message.session_id) ctx.setClaudeSessionId(message.session_id);
        const error = message.is_error
          ? message.errors?.join("\n") || message.result || "Claude Code returned an error"
          : undefined;
        ctx.publish({
          type: "turn_end",
          turnId,
          stopReason: error ? "error" : "end_turn",
          ...(error ? { error } : {}),
        });
        text = "";
      }
    }
  };
}
