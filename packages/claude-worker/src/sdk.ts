/**
 * Agent SDK adapter. `query` is injected so tests never load the real SDK
 * and CI never calls Anthropic. The options are the lockdown: no built-in
 * tools, no settings, no request relay, retries off.
 */
import { z } from "zod";
import { workerProcessEnv } from "./guards";
import { newToolUseId, type QueryContext, type QueryFactory } from "./sessions";
import { asRateLimitInfo, usagePauseReason } from "./usage";
import {
  claudeCodeModelSchema,
  type ClaudeCodeModel,
  type ImagePart,
  type JsonSchema,
} from "./protocol";

interface SdkToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ClaudeSdkModule {
  /** `close()` ends the Claude Code process (older SDKs lack it: the loop stops reading instead). */
  query: (args: {
    prompt: AsyncIterable<SdkUserMessage>;
    options: SdkQueryOptions;
  }) => AsyncIterable<SdkMessage> & { close?(): void };
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
  /** Absent: Claude Code runs without a turn limit (opt-in "unlimited"). */
  maxTurns?: number;
  permissionMode: "dontAsk";
  allowedTools: string[];
  mcpServers: Record<string, unknown>;
  env: Record<string, string>;
  includePartialMessages: false;
}

interface SdkUserMessage {
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

interface SdkMessage {
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
  maxTurns?: number;
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
    ...(input.maxTurns ? { maxTurns: input.maxTurns } : {}),
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

/** The `Query` methods the model list reads. Older SDKs lack some. */
interface ModelListingQuery {
  initializationResult?(): Promise<{ models?: unknown }>;
  supportedModels?(): Promise<unknown>;
  close?(): void;
}

/** Claude Code's model list for the signed-in account. */
export type ModelLister = () => Promise<ClaudeCodeModel[]>;

const MODEL_LIST_TIMEOUT_MS = 45_000;

function asModels(value: unknown): ClaudeCodeModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = claudeCodeModelSchema.safeParse(item);
    if (!parsed.success) return [];
    const { value: id, displayName, description, resolvedModel } = parsed.data;
    return [
      {
        value: id,
        displayName,
        ...(description ? { description } : {}),
        ...(resolvedModel ? { resolvedModel } : {}),
      },
    ];
  });
}

/**
 * Ask Claude Code which models this login can use: start a query that never
 * sends a prompt, read its initialization (the `ModelInfo` list, with each
 * alias's resolved model), then close it. No tools, no settings, no turn:
 * nothing is sent to the model. Concurrent calls share one query.
 */
export function createSdkModelLister(
  sdk: ClaudeSdkModule,
  env: Record<string, string | undefined>,
  timeoutMs = MODEL_LIST_TIMEOUT_MS,
): ModelLister {
  let inflight: Promise<ClaudeCodeModel[]> | undefined;
  const listOnce = async (): Promise<ClaudeCodeModel[]> => {
    const workerEnv = workerProcessEnv(env);
    if ("ANTHROPIC_BASE_URL" in workerEnv) throw new Error("Refusing to set ANTHROPIC_BASE_URL.");
    let release: () => void = () => {};
    const closed = new Promise<void>((resolve) => (release = resolve));
    const prompt = (async function* (): AsyncIterable<SdkUserMessage> {
      await closed;
    })();
    const query = sdk.query({
      prompt,
      options: {
        tools: [],
        strictMcpConfig: true,
        settingSources: [],
        maxTurns: 1,
        permissionMode: "dontAsk",
        allowedTools: [],
        mcpServers: {},
        env: workerEnv,
        includePartialMessages: false,
      } as unknown as SdkQueryOptions,
    }) as AsyncIterable<SdkMessage> & ModelListingQuery;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const read = query.initializationResult
        ? query.initializationResult().then((result) => result.models)
        : query.supportedModels
          ? query.supportedModels()
          : Promise.reject(new Error("This Agent SDK cannot list Claude Code's models."));
      const models = await Promise.race([
        read,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Claude Code did not list its models in time.")),
            timeoutMs,
          );
        }),
      ]);
      return asModels(models);
    } finally {
      if (timer) clearTimeout(timer);
      release();
      query.close?.();
    }
  };
  return () => {
    inflight ??= listOnce().finally(() => (inflight = undefined));
    return inflight;
  };
}

export function createSdkQueryFactory(
  sdk: ClaudeSdkModule,
  env: Record<string, string | undefined>,
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
    // A stop (or a recycle) ends the Claude Code process itself, not only
    // this loop: the turn must not go on running tools nobody reads.
    const stop = () => stream.close?.();
    if (ctx.signal.aborted) stop();
    else ctx.signal.addEventListener("abort", stop, { once: true });
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
        const error = message.is_error ? resultError(message) : undefined;
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

/** A failed result's message; running out of turns says where to raise the limit. */
function resultError(message: SdkMessage): string {
  const text = message.errors?.join("\n") || message.result || "Claude Code returned an error";
  return message.subtype === "error_max_turns"
    ? `${text}. Raise "Max turns" in Settings → Models → Claude plan, then send a message to continue.`
    : text;
}
