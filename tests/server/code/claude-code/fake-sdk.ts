import { randomUUID } from "node:crypto";
import type {
  CodingHistoryMessage,
  CodingQuery,
  CodingQueryOptions,
  CodingSdk,
  CodingSdkMessage,
  CodingSdkUserMessage,
} from "../../../../packages/claude-worker/src/index";

const END = Symbol("end");

class Channel<T> {
  private readonly items: Array<T | typeof END> = [];
  private readonly waiters: Array<(value: T | typeof END) => void> = [];

  push(value: T | typeof END): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.items.push(value);
  }

  next(): Promise<T | typeof END> {
    if (this.items.length > 0) return Promise.resolve(this.items.shift()!);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export class FakeQuery implements CodingQuery {
  readonly out = new Channel<CodingSdkMessage>();
  readonly received: CodingSdkUserMessage[] = [];
  interrupts = 0;
  closed = false;
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  private readonly inputIterator: AsyncIterator<CodingSdkUserMessage>;
  private interruptWaiters: Array<() => void> = [];

  constructor(
    readonly sdk: FakeSdk,
    prompt: AsyncIterable<CodingSdkUserMessage>,
    readonly options: CodingQueryOptions,
  ) {
    this.inputIterator = prompt[Symbol.asyncIterator]();
  }

  get sessionId(): string {
    return this.sdk.sessionIdOf(this);
  }

  async nextInput(): Promise<CodingSdkUserMessage | undefined> {
    const next = await this.inputIterator.next();
    if (next.done) return undefined;
    this.received.push(next.value);
    this.sdk.persist(this.sessionId, {
      type: "user",
      uuid: next.value.uuid,
      message: next.value.message,
      parent_tool_use_id: null,
    });
    return next.value;
  }

  emit(message: CodingSdkMessage): void {
    if (this.closed) return;
    const persisted =
      (message.type === "assistant" || message.type === "user") && !message.parent_tool_use_id;
    if (persisted || (message.type === "system" && message.subtype === "compact_boundary")) {
      this.sdk.persist(this.sessionId, message);
    }
    this.out.push(message);
  }

  end(): void {
    this.out.push(END);
  }

  waitInterrupt(): Promise<void> {
    return new Promise((resolve) => this.interruptWaiters.push(resolve));
  }

  async interrupt(): Promise<unknown> {
    this.interrupts += 1;
    this.calls.push({ method: "interrupt", args: [] });
    const waiters = this.interruptWaiters;
    this.interruptWaiters = [];
    for (const waiter of waiters) waiter();
    return { still_queued: [] };
  }

  async setModel(model?: string): Promise<void> {
    this.calls.push({ method: "setModel", args: [model] });
  }

  async setPermissionMode(mode: string): Promise<void> {
    this.calls.push({ method: "setPermissionMode", args: [mode] });
  }

  async applyFlagSettings(settings: Record<string, unknown>): Promise<void> {
    this.calls.push({ method: "applyFlagSettings", args: [settings] });
  }

  async supportedCommands() {
    return [
      { name: "compact", description: "Clear history but keep a summary", argumentHint: "" },
      { name: "review", description: "Review a pull request", argumentHint: "<pr>" },
    ];
  }

  async supportedModels() {
    return [
      { value: "default", displayName: "Default (Opus)", description: "Recommended" },
      { value: "sonnet", displayName: "Sonnet", description: "Everyday tasks" },
    ];
  }

  private closeWaiters: Array<() => void> = [];

  whenClosed(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => this.closeWaiters.push(resolve));
  }

  close(): void {
    this.closed = true;
    this.calls.push({ method: "close", args: [] });
    this.end();
    for (const waiter of this.closeWaiters.splice(0)) waiter();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<CodingSdkMessage> {
    while (true) {
      // eslint-disable-next-line react-doctor/async-await-in-loop
      const next = await this.out.next();
      if (next === END) return;
      if (next.type === "__crash") throw next.error;
      yield next;
    }
  }
}

export type Brain = (query: FakeQuery) => Promise<void>;

export const manual: Brain = async (query) => {
  query.emit(init(query));
  await query.whenClosed();
};

export const echo: Brain = async (query) => {
  query.emit(init(query));
  let cost = 0;
  for await (const input of prompts(query)) {
    const answer = `Echo: ${input.message.content}`;
    query.emit(delta(query, answer.slice(0, 4)));
    query.emit(delta(query, answer.slice(4)));
    query.emit(text(query, answer));
    cost += 0.01;
    query.emit(result(query, { totalCost: cost, text: answer }));
  }
};

async function* prompts(query: FakeQuery): AsyncGenerator<CodingSdkUserMessage> {
  while (true) {
    // eslint-disable-next-line react-doctor/async-await-in-loop
    const input = await query.nextInput();
    if (!input) return;
    yield input;
  }
}

export interface FakeTool {
  name: string;
  description: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface FakeMcpServer {
  name: string;
  tools: FakeTool[];
}

export class FakeSdk implements CodingSdk {
  readonly queries: FakeQuery[] = [];
  readonly transcripts = new Map<string, CodingHistoryMessage[]>();
  private readonly ids = new Map<FakeQuery, string>();

  constructor(public brain: Brain) {}

  sessionIdOf(query: FakeQuery): string {
    let id = this.ids.get(query);
    if (!id) {
      id = query.options.resume ?? randomUUID();
      this.ids.set(query, id);
    }
    return id;
  }

  persist(sessionId: string, message: Partial<CodingHistoryMessage> & { type: string }): void {
    const list = this.transcripts.get(sessionId) ?? [];
    const { parent_tool_use_id = null, uuid = randomUUID(), message: body, ...rest } = message;
    list.push({
      ...rest,
      type: message.type,
      uuid,
      session_id: sessionId,
      message: body,
      parent_tool_use_id,
    });
    this.transcripts.set(sessionId, list);
  }

  query(args: { prompt: AsyncIterable<CodingSdkUserMessage>; options: CodingQueryOptions }) {
    const query = new FakeQuery(this, args.prompt, args.options);
    this.queries.push(query);
    void this.brain(query).then(
      () => query.end(),
      (error: unknown) => query.out.push({ type: "__crash", error }),
    );
    return query;
  }

  tool(name: string, description: string, _shape: unknown, handler: FakeTool["handler"]): FakeTool {
    return { name, description, handler };
  }

  createSdkMcpServer(options: { name: string; tools: unknown[] }): FakeMcpServer {
    return { name: options.name, tools: options.tools as FakeTool[] };
  }

  async getSessionMessages(sessionId: string): Promise<CodingHistoryMessage[]> {
    return structuredClone(this.transcripts.get(sessionId) ?? []);
  }

  async forkSession(
    sessionId: string,
    options?: { upToMessageId?: string },
  ): Promise<{ sessionId: string }> {
    const source = this.transcripts.get(sessionId) ?? [];
    const end = options?.upToMessageId
      ? source.findIndex((entry) => entry.uuid === options.upToMessageId)
      : source.length - 1;
    const forkId = randomUUID();
    this.transcripts.set(
      forkId,
      source
        .slice(0, end + 1)
        .map((entry) => ({ ...structuredClone(entry), uuid: randomUUID(), session_id: forkId })),
    );
    return { sessionId: forkId };
  }
}

function init(query: FakeQuery): CodingSdkMessage {
  return {
    type: "system",
    subtype: "init",
    session_id: query.sessionId,
    uuid: randomUUID(),
    cwd: query.options.cwd,
    model: "claude-opus-4-7",
    permissionMode: query.options.permissionMode,
    tools: ["Bash", "Edit", "Read"],
    slash_commands: ["compact", "review"],
    apiKeySource: "none",
    claude_code_version: "2.3.0",
    mcp_servers: [],
    output_style: "default",
    skills: [],
    plugins: [],
  };
}

const USAGE = {
  input_tokens: 1200,
  output_tokens: 80,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 15000,
};

function assistant(
  query: FakeQuery,
  content: unknown[],
  extra: Record<string, unknown> = {},
): CodingSdkMessage {
  return {
    type: "assistant",
    uuid: randomUUID(),
    session_id: query.sessionId,
    parent_tool_use_id: null,
    message: {
      id: `msg_${randomUUID().slice(0, 8)}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-7",
      content,
      stop_reason: null,
      usage: USAGE,
    },
    ...extra,
  };
}

export function text(query: FakeQuery, value: string): CodingSdkMessage {
  return assistant(query, [{ type: "text", text: value }]);
}

export function toolUse(query: FakeQuery, id: string, name: string, input: unknown) {
  return assistant(query, [{ type: "tool_use", id, name, input }]);
}

export function toolResult(
  query: FakeQuery,
  toolUseId: string,
  content: string,
  extra: { isError?: boolean; toolUseResult?: unknown } = {},
): CodingSdkMessage {
  return {
    type: "user",
    uuid: randomUUID(),
    session_id: query.sessionId,
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content,
          ...(extra.isError ? { is_error: true } : {}),
        },
      ],
    },
    ...(extra.toolUseResult ? { tool_use_result: extra.toolUseResult } : {}),
  };
}

export function delta(query: FakeQuery, value: string, kind: "text" | "thinking" = "text") {
  return {
    type: "stream_event",
    uuid: randomUUID(),
    session_id: query.sessionId,
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      index: 0,
      delta:
        kind === "text"
          ? { type: "text_delta", text: value }
          : { type: "thinking_delta", thinking: value },
    },
  };
}

export function result(
  query: FakeQuery,
  input: {
    totalCost: number;
    isError?: boolean;
    errors?: string[];
    text?: string;
    queuedTurnCount?: number;
    durationMs?: number;
  },
): CodingSdkMessage {
  const base = {
    type: "result",
    uuid: randomUUID(),
    session_id: query.sessionId,
    duration_ms: input.durationMs ?? 1500,
    duration_api_ms: 1200,
    num_turns: 1,
    stop_reason: input.isError ? null : "end_turn",
    total_cost_usd: input.totalCost,
    usage: { input_tokens: 1200, output_tokens: 80 },
    modelUsage: {
      "claude-opus-4-7": {
        inputTokens: 1200,
        outputTokens: 80,
        cacheReadInputTokens: 15000,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: input.totalCost,
        contextWindow: 200000,
        maxOutputTokens: 32000,
      },
    },
    permission_denials: [],
    is_error: !!input.isError,
    ...(input.queuedTurnCount !== undefined ? { queued_turn_count: input.queuedTurnCount } : {}),
  };
  return input.isError
    ? { ...base, subtype: "error_during_execution", errors: input.errors ?? ["failed"] }
    : { ...base, subtype: "success", result: input.text ?? "" };
}
