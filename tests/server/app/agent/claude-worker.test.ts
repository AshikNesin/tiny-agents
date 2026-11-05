/**
 * Claude plan engine and worker. No network except a localhost WebSocket
 * with an injected SDK. Nothing here calls Anthropic.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { WebSocket } from "ws";
import {
  ClaudeWorkerClient,
  type WebSocketLike,
} from "../../../../packages/agent/src/engines/claude-code/client";
import {
  DEFAULT_TIMINGS,
  OverrideRefusal,
  SessionBook,
  SessionLimitError,
  ToolProxy,
  assertNoOverrides,
  buildSdkOptions,
  conflictingOverrides,
  createClaudeWorkerServer,
  createSdkQueryFactory,
  isSubscriptionLogin,
  parseAuthStatus,
  parseClientMessage,
  usagePauseReason,
  workerProcessEnv,
  type ClaudeSdkModule,
  type QueryFactory,
  type SdkQueryOptions,
  type Timings,
  type WorkerMessage,
} from "../../../../packages/claude-worker/src/index";

const TOKEN = Buffer.alloc(32, 7).toString("base64");
const servers: { close: () => Promise<void> }[] = [];
const clients: { close: () => void }[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.useRealTimers();
});

const fastTimings: Timings = {
  ...DEFAULT_TIMINGS,
  pingIntervalMs: 60_000,
  silenceCloseMs: 180_000,
  reconnectMinMs: 15,
  reconnectMaxMs: 30,
};

function subscribed() {
  return Promise.resolve({
    loggedIn: true,
    authMethod: "claude.ai",
    subscriptionType: "max",
  });
}

describe("protocol and guards", () => {
  it("rejects a client message that is missing its session", () => {
    expect(
      parseClientMessage({ type: "turn", text: "hi", model: "sonnet", turnId: "t" }),
    ).toBeUndefined();
    expect(
      parseClientMessage({
        type: "turn",
        sessionId: "1",
        turnId: "t",
        text: "hi",
        model: "claude-sonnet-4-6",
      })?.type,
    ).toBe("turn");
  });

  it("refuses API key, base URL, Bedrock, Vertex and Foundry overrides", () => {
    expect(conflictingOverrides({})).toEqual([]);
    expect(conflictingOverrides({ ANTHROPIC_API_KEY: "sk-ant-api" })).toEqual([
      "ANTHROPIC_API_KEY",
    ]);
    expect(conflictingOverrides({ ANTHROPIC_BASE_URL: "http://127.0.0.1:9" })).toContain(
      "ANTHROPIC_BASE_URL",
    );
    expect(conflictingOverrides({ CLAUDE_CODE_USE_BEDROCK: "1" })).toContain(
      "CLAUDE_CODE_USE_BEDROCK",
    );
    expect(conflictingOverrides({ CLAUDE_CODE_USE_VERTEX: "true" })).toContain(
      "CLAUDE_CODE_USE_VERTEX",
    );
    expect(conflictingOverrides({ CLAUDE_CODE_USE_FOUNDRY: "yes" })).toContain(
      "CLAUDE_CODE_USE_FOUNDRY",
    );
    expect(conflictingOverrides({ CLAUDE_CODE_USE_BEDROCK: "0" })).toEqual([]);
    expect(() => assertNoOverrides({ ANTHROPIC_AUTH_TOKEN: "x" })).toThrow(OverrideRefusal);
  });

  it("never puts ANTHROPIC_BASE_URL into the worker environment", () => {
    const env = workerProcessEnv({ PATH: "/usr/bin", HOME: "/tmp/worker" });
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.CLAUDE_CODE_MAX_RETRIES).toBe("0");
    expect("ANTHROPIC_BASE_URL" in env).toBe(false);
  });

  it("pauses on rejected limits, credits_required, and isUsingOverage when present", () => {
    expect(usagePauseReason({ status: "allowed" })).toBeUndefined();
    expect(usagePauseReason({ status: "rejected" })).toMatch(/rejected/);
    expect(usagePauseReason({ errorCode: "credits_required" })).toMatch(/credits_required/);
    expect(usagePauseReason({})).toBeUndefined();
    expect(usagePauseReason({ isUsingOverage: true })).toMatch(/isUsingOverage/);
    expect(usagePauseReason({ isUsingOverage: false })).toBeUndefined();
  });

  it("requires a subscription login from claude auth status", () => {
    expect(
      isSubscriptionLogin(
        parseAuthStatus('{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}'),
      ),
    ).toBe(true);
    expect(
      isSubscriptionLogin(
        parseAuthStatus('{"loggedIn":true,"authMethod":"api_key","subscriptionType":"max"}'),
      ),
    ).toBe(false);
    expect(isSubscriptionLogin(parseAuthStatus('{"loggedIn":true,"authMethod":"claude.ai"}'))).toBe(
      false,
    );
    expect(isSubscriptionLogin(parseAuthStatus("not json"))).toBe(false);
  });
});

describe("tool proxy, caps, eviction", () => {
  it("returns one error result when the tool wait exceeds 120s (fake timers)", async () => {
    vi.useFakeTimers();
    const proxy = new ToolProxy(120_000);
    const pending = proxy.wait("toolu_1");
    await vi.advanceTimersByTimeAsync(119_000);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/120000ms/);
    expect(proxy.settle("toolu_1", { content: "late" })).toBe(false);
  });

  it("evicts idle processes and recycles sessions older than the max age", async () => {
    const factory: QueryFactory = async (ctx) => {
      for await (const turn of ctx.turns) {
        ctx.publish({ type: "turn_end", turnId: turn.turnId, stopReason: "end_turn" });
      }
    };
    const timings = { ...DEFAULT_TIMINGS, idleEvictMs: 1_000, maxSessionAgeMs: 5_000 };
    const book = new SessionBook(factory, timings);
    const session = await book.runTurn(
      { sessionId: "s", model: "claude-sonnet-4-6", tools: [] },
      { turnId: "t", text: "hi" },
      0,
    );
    expect(session.alive).toBe(true);
    book.sweep(1_000);
    expect(session.alive).toBe(false);
    expect(book.liveProcesses()).toBe(0);

    const aged = await book.runTurn(
      { sessionId: "old", model: "claude-sonnet-4-6", tools: [] },
      { turnId: "t2", text: "hi" },
      0,
    );
    aged.touch(4_000);
    book.sweep(5_000);
    expect(aged.alive).toBe(false);
  });

  it("allows two live processes and one running turn", async () => {
    const release: (() => void)[] = [];
    const factory: QueryFactory = async (ctx) => {
      for await (const turn of ctx.turns) {
        ctx.publish({ type: "turn_end", turnId: turn.turnId, stopReason: "end_turn" });
        await new Promise<void>((resolve) => release.push(resolve));
      }
    };
    const book = new SessionBook(factory, {
      ...DEFAULT_TIMINGS,
      maxLiveProcesses: 2,
      maxRunningTurns: 1,
    });
    const open = (id: string) => ({
      sessionId: id,
      model: "claude-sonnet-4-6",
      tools: [] as const,
    });
    await book.runTurn(open("a"), { turnId: "1", text: "a" }, 0);
    await book.runTurn(open("b"), { turnId: "2", text: "b" }, 0);
    expect(book.liveProcesses()).toBe(2);
    await expect(book.runTurn(open("c"), { turnId: "3", text: "c" }, 0)).rejects.toBeInstanceOf(
      SessionLimitError,
    );

    const running = book.runTurn(open("a"), { turnId: "4", text: "again" }, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(book.runningTurns).toBe(1);
    await expect(book.runTurn(open("b"), { turnId: "5", text: "nope" }, 1)).rejects.toMatchObject({
      code: "turn_busy",
    });
    release.splice(0).forEach((fn) => fn());
    await running;
  });
});

describe("SDK lockdown", () => {
  it("passes an empty tool list and does not set a base URL", async () => {
    const seen: SdkQueryOptions[] = [];
    const sdk: ClaudeSdkModule = {
      query: (args) => {
        seen.push(args.options);
        return (async function* () {
          /* the worker must not need a live Claude process in CI */
        })();
      },
      tool: (name) => ({ name }),
      createSdkMcpServer: (opts) => ({ name: opts.name, toolCount: opts.tools.length }),
    };
    const factory = createSdkQueryFactory(sdk, { PATH: "/usr/bin" });
    await factory({
      model: "claude-sonnet-4-6",
      system: "be brief",
      tools: [{ name: "web_search", description: "Search", inputSchema: { type: "object" } }],
      signal: new AbortController().signal,
      turns: (async function* () {})(),
      publish: () => undefined,
      callTool: async () => ({ content: "" }),
      setClaudeSessionId: () => undefined,
      maxTurns: 30,
    });
    expect(seen).toHaveLength(1);
    const options = seen[0]!;
    expect(options.tools).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.settingSources).toEqual([]);
    expect(options.maxTurns).toBe(30);
    expect(options.env.CLAUDE_CODE_MAX_RETRIES).toBe("0");
    expect(options.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect("ANTHROPIC_BASE_URL" in options).toBe(false);
    expect(options.allowedTools).toEqual(["mcp__tiny-agents__web_search"]);
  });

  it("refuses to build options when an override is present", () => {
    expect(() =>
      buildSdkOptions({
        model: "claude-sonnet-4-6",
        maxTurns: 30,
        env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:1" },
        mcpServer: {},
        toolNames: [],
      }),
    ).toThrow(OverrideRefusal);
  });
});

describe("localhost worker", () => {
  it("rejects a bad bearer token before the socket opens and binds loopback", async () => {
    const server = await createClaudeWorkerServer({
      token: TOKEN,
      query: async () => undefined,
      authStatus: subscribed,
      env: {},
      timings: fastTimings,
      port: 0,
    });
    servers.push(server);
    expect(server.url.startsWith("ws://127.0.0.1:")).toBe(true);
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(server.url, { headers: { Authorization: "Bearer nope" } });
      ws.on("unexpected-response", (_req, res) => {
        expect(res.statusCode).toBe(401);
        ws.close();
        resolve();
      });
      ws.on("open", () => reject(new Error("unauthorized socket was accepted")));
      ws.on("error", () => undefined);
    });
  });

  it("streams a turn, proxies a tool, and resumes a dropped socket without running the tool twice", async () => {
    const release: { go?: (result: { content: string }) => void } = {};
    const executions: string[] = [];
    const query: QueryFactory = async (ctx) => {
      ctx.setClaudeSessionId("claude-session-1");
      for await (const turn of ctx.turns) {
        ctx.publish({ type: "text", turnId: turn.turnId, text: "Working" });
        const result = await ctx.callTool({
          turnId: turn.turnId,
          toolUseId: "toolu_once",
          name: "web_search",
          input: { query: "tide" },
        });
        ctx.publish({ type: "text", turnId: turn.turnId, text: result.content });
        ctx.publish({ type: "turn_end", turnId: turn.turnId, stopReason: "end_turn" });
      }
    };
    const server = await createClaudeWorkerServer({
      token: TOKEN,
      query,
      authStatus: subscribed,
      env: {},
      timings: fastTimings,
      port: 0,
    });
    servers.push(server);

    const events: WorkerMessage[] = [];
    const run = (call: { toolUseId: string }) => {
      executions.push(call.toolUseId);
      return new Promise<{ content: string }>((resolve) => {
        release.go = resolve;
      });
    };
    const client = new ClaudeWorkerClient({
      url: server.url,
      token: TOKEN,
      timings: fastTimings,
      onEvent: (message) => events.push(message),
      onTool: (call) => run(call),
    });
    clients.push(client);

    await vi.waitFor(() => expect(events.some((message) => message.type === "welcome")).toBe(true));
    client.send({
      type: "turn",
      sessionId: "9",
      turnId: "turn-1",
      text: "search the tide",
      model: "claude-sonnet-4-6",
      tools: [{ name: "web_search", description: "Search", inputSchema: { type: "object" } }],
    });
    await vi.waitFor(() => expect(executions).toEqual(["toolu_once"]));
    client.drop();
    await vi.waitFor(() =>
      expect(events.filter((message) => message.type === "welcome").length).toBeGreaterThan(1),
    );
    expect(executions).toEqual(["toolu_once"]);
    release.go?.({ content: "searched" });
    await vi.waitFor(() =>
      expect(
        events.some(
          (message) =>
            message.type === "event" &&
            message.event.type === "text" &&
            message.event.text === "searched",
        ),
      ).toBe(true),
    );
    expect(executions).toEqual(["toolu_once"]);
  });

  it("returns an error tool result when the 120s timer fires", async () => {
    let fire: (() => void) | undefined;
    const query: QueryFactory = async (ctx) => {
      for await (const turn of ctx.turns) {
        const result = await ctx.callTool({
          turnId: turn.turnId,
          toolUseId: "toolu_slow",
          name: "web_search",
          input: {},
        });
        ctx.publish({ type: "text", turnId: turn.turnId, text: result.content });
        ctx.publish({
          type: "turn_end",
          turnId: turn.turnId,
          stopReason: result.isError ? "error" : "end_turn",
        });
      }
    };
    const server = await createClaudeWorkerServer({
      token: TOKEN,
      query,
      authStatus: subscribed,
      env: {},
      timings: { ...fastTimings, toolResultTimeoutMs: 120_000 },
      arm: (fn, ms) => {
        expect(ms).toBe(120_000);
        fire = fn;
        return () => undefined;
      },
      port: 0,
    });
    servers.push(server);
    const events: WorkerMessage[] = [];
    const client = new ClaudeWorkerClient({
      url: server.url,
      token: TOKEN,
      timings: fastTimings,
      onEvent: (message) => events.push(message),
      onTool: () => new Promise(() => undefined),
    });
    clients.push(client);
    await vi.waitFor(() => expect(events.some((message) => message.type === "welcome")).toBe(true));
    client.send({
      type: "turn",
      sessionId: "3",
      turnId: "slow",
      text: "wait",
      model: "claude-sonnet-4-6",
    });
    await vi.waitFor(() => expect(fire).toBeTypeOf("function"));
    fire?.();
    await vi.waitFor(() =>
      expect(
        events.some(
          (message) =>
            message.type === "event" &&
            message.event.type === "text" &&
            /120000ms/.test(message.event.text),
        ),
      ).toBe(true),
    );
  });
});

describe("idle socket heartbeats", () => {
  it("survives an hour when pongs keep arriving and closes after 60s of silence", () => {
    let now = 0;
    const timers: { at: number; fn: () => void; dead: boolean }[] = [];
    const schedule = (fn: () => void, ms: number) => {
      const item = { at: now + ms, fn, dead: false };
      timers.push(item);
      return () => {
        item.dead = true;
      };
    };
    const advance = (ms: number) => {
      now += ms;
      for (const item of timers) {
        if (!item.dead && item.at <= now) {
          item.dead = true;
          item.fn();
        }
      }
    };
    const socket = fakeSocket();
    const client = new ClaudeWorkerClient({
      url: "ws://127.0.0.1:9",
      token: TOKEN,
      timings: { ...DEFAULT_TIMINGS, pingIntervalMs: 20_000, silenceCloseMs: 60_000 },
      now: () => now,
      schedule,
      connect: () => socket,
      onEvent: () => undefined,
      onTool: async () => ({ content: "" }),
    });
    clients.push(client);
    socket.readyState = 1;
    socket.emit("open");
    for (let step = 0; step < 180; step++) advance(20_000);
    expect(socket.closed).toBe(false);
    socket.ping = () => undefined;
    advance(60_000);
    expect(socket.closed).toBe(true);
  });
});

function fakeSocket(): WebSocketLike & {
  emit: (event: string, ...args: unknown[]) => void;
  closed: boolean;
} {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const socket = {
    readyState: 0,
    closed: false,
    sent: [] as string[],
    on(event: string, listener: (...args: unknown[]) => void) {
      const list = handlers.get(event) ?? [];
      list.push(listener);
      handlers.set(event, list);
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of handlers.get(event) ?? []) listener(...args);
    },
    send(data: string) {
      socket.sent.push(data);
    },
    close() {
      socket.closed = true;
      socket.readyState = 3;
      socket.emit("close");
    },
    ping() {
      socket.emit("pong");
    },
  };
  return socket;
}
