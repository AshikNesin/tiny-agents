import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { until } from "../../fixtures/until";
import { WebSocket } from "ws";
import { Type } from "typebox";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import { secretRedactor } from "../../../../packages/agent/src/redact";
import {
  ClaudeWorkerClient,
  type WebSocketLike,
} from "../../../../packages/agent/src/engines/claude-code/client";
import {
  OWNER_WAIT_KEEPALIVE_MS,
  WORKER_RESTARTED,
} from "../../../../packages/agent/src/engines/claude-code/engine";
import type { ChatMessage } from "../../../../packages/agent/src/types";
import { awaitingApproval, mailCapability, openEngine, watch, VAULT_VALUE } from "./engine-harness";
import {
  DEFAULT_TIMINGS,
  OverrideRefusal,
  SessionBook,
  SessionLimitError,
  ToolProxy,
  assertNoOverrides,
  buildCodingSdkOptions,
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
  type SessionEvent,
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

function botClient(
  url: string,
  handlers: Pick<ConstructorParameters<typeof ClaudeWorkerClient>[0], "onTool">,
) {
  const events: WorkerMessage[] = [];
  const sockets: WebSocket[] = [];
  const connects: boolean[] = [];
  const client = new ClaudeWorkerClient({
    resolveTarget: async () => ({ url, token: TOKEN }),
    timings: fastTimings,
    connect: (target, token) => {
      const socket = new WebSocket(target, { headers: { Authorization: `Bearer ${token}` } });
      sockets.push(socket);
      return socket as unknown as WebSocketLike;
    },
    onEvent: (message) => events.push(message),
    onConnected: (rebooted) => connects.push(rebooted),
    ...handlers,
  });
  clients.push(client);
  return { client, events, sockets, connects };
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

  it("keeps the worker's own auth token out of every subprocess environment", async () => {
    const base = {
      PATH: "/usr/bin",
      HOME: "/tmp/worker",
      CLAUDE_WORKER_TOKEN: TOKEN,
      CLAUDE_WORKER_PORT: "8765",
    };
    const seen: SdkQueryOptions["env"][] = [];
    const sdk: ClaudeSdkModule = {
      query: (args) => {
        seen.push(args.options.env);
        return (async function* () {})();
      },
      tool: (name) => ({ name }),
      createSdkMcpServer: (opts) => ({ name: opts.name }),
    };
    const factory = createSdkQueryFactory(sdk, base);
    await factory({
      model: "claude-sonnet-4-6",
      tools: [],
      signal: new AbortController().signal,
      turns: (async function* () {})(),
      publish: () => undefined,
      callTool: async () => ({ content: "" }),
      setClaudeSessionId: () => undefined,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.CLAUDE_WORKER_TOKEN).toBeUndefined();
    expect("CLAUDE_WORKER_TOKEN" in seen[0]!).toBe(false);
    expect(seen[0]!.PATH).toBe("/usr/bin");

    const coding = buildCodingSdkOptions({
      cwd: "/tmp/worker",
      env: base,
      canUseTool: async () => ({ behavior: "allow", updatedInput: {} }),
    });
    expect(coding.env.CLAUDE_WORKER_TOKEN).toBeUndefined();
    expect("CLAUDE_WORKER_TOKEN" in coding.env).toBe(false);

    const server = await createClaudeWorkerServer({
      token: TOKEN,
      query: createSdkQueryFactory(sdk, base),
      authStatus: subscribed,
      env: base,
      timings: fastTimings,
      port: 0,
    });
    servers.push(server);
    const { client, connects } = botClient(server.url, {
      onTool: () => new Promise(() => undefined),
    });
    client.track("1");
    await vi.waitFor(() => expect(connects).toEqual([false]));
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

  it("starts a waiting call's timer over when the app says it still waits", async () => {
    const timers: { ms: number; cleared: boolean }[] = [];
    const proxy = new ToolProxy(120_000, (_fn, ms) => {
      const timer = { ms, cleared: false };
      timers.push(timer);
      return () => {
        timer.cleared = true;
      };
    });
    const pending = proxy.wait("toolu_1");
    expect(proxy.extend("toolu_1")).toBe(true);
    expect(proxy.extend("toolu_1")).toBe(true);
    expect(timers).toEqual([
      { ms: 120_000, cleared: true },
      { ms: 120_000, cleared: true },
      { ms: 120_000, cleared: false },
    ]);
    expect(proxy.settle("toolu_1", { content: "approved and sent" })).toBe(true);
    expect(await pending).toEqual({ content: "approved and sent" });
    expect(timers.at(-1)?.cleared).toBe(true);
    expect(proxy.extend("toolu_1")).toBe(false);
    expect(proxy.extend("toolu_unknown")).toBe(false);
  });

  it("stops the query when a turn is aborted, so nothing of it runs later", async () => {
    const signals: AbortSignal[] = [];
    const factory: QueryFactory = async (ctx) => {
      signals.push(ctx.signal);
      for await (const turn of ctx.turns) {
        ctx.publish({ type: "text", turnId: turn.turnId, text: "working" });
        await new Promise<void>((resolve) =>
          ctx.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        ctx.publish({ type: "text", turnId: turn.turnId, text: "still going" });
        ctx.publish({ type: "turn_end", turnId: turn.turnId, stopReason: "end_turn" });
      }
    };
    const book = new SessionBook(factory, DEFAULT_TIMINGS);
    const open = { sessionId: "s", model: "claude-sonnet-4-6", tools: [] as const };
    const running = book.runTurn(open, { turnId: "t1", text: "go" }, 0);
    await until(() => book.get("s")?.log.replay(0).length === 1, "the turn's first text");
    const session = book.get("s")!;
    session.abortTurn();
    await running;
    expect(signals[0]?.aborted).toBe(true);
    expect(session.alive).toBe(false);
    expect(book.runningTurns).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const events = session.log.replay(0).map((item) => item.event);
    expect(events).toEqual<SessionEvent[]>([
      { type: "text", turnId: "t1", text: "working" },
      { type: "turn_end", turnId: "t1", stopReason: "aborted" },
    ]);

    const next = book.runTurn(open, { turnId: "t2", text: "again" }, 1);
    await until(() => signals.length === 2, "a new process");
    expect(signals[1]?.aborted).toBe(false);
    book.get("s")!.abortTurn();
    await next;
  });

  it("closes the Claude Code query when its turn is stopped", async () => {
    let closed = 0;
    const sdk: ClaudeSdkModule = {
      query: (args) =>
        Object.assign(
          (async function* () {
            for await (const _ of args.prompt) {
              yield { type: "assistant", message: { content: [{ type: "text", text: "on it" }] } };
              await new Promise(() => undefined);
            }
          })(),
          {
            close: () => {
              closed += 1;
            },
          },
        ),
      tool: (name) => ({ name }),
      createSdkMcpServer: (opts) => ({ name: opts.name, toolCount: opts.tools.length }),
    };
    const abort = new AbortController();
    const events: SessionEvent[] = [];
    void createSdkQueryFactory(sdk, { PATH: "/usr/bin" })({
      model: "claude-sonnet-4-6",
      tools: [],
      signal: abort.signal,
      turns: (async function* () {
        yield { turnId: "t", text: "browse" };
        await new Promise(() => undefined);
      })(),
      publish: (event) => events.push(event),
      callTool: async () => ({ content: "" }),
      setClaudeSessionId: () => undefined,
    });
    await until(() => events.length === 1, "the turn's text");
    expect(closed).toBe(0);
    abort.abort();
    expect(closed).toBe(1);
  });

  it("resolves the turn on a usage pause, so the next turn is not refused as busy", async () => {
    const factory: QueryFactory = async (ctx) => {
      for await (const turn of ctx.turns) {
        ctx.publish({ type: "usage_pause", turnId: turn.turnId, reason: "rejected" });
        await new Promise(() => undefined);
      }
    };
    const book = new SessionBook(factory, DEFAULT_TIMINGS);
    const open = { sessionId: "s", model: "claude-sonnet-4-6", tools: [] as const };
    const session = await book.runTurn(open, { turnId: "t1", text: "hi" }, 0);
    expect(book.runningTurns).toBe(0);
    expect(session.log.replay(0).map((item) => item.event)).toEqual([
      { type: "usage_pause", turnId: "t1", reason: "rejected" },
      expect.objectContaining({ type: "turn_end", turnId: "t1", stopReason: "paused" }),
    ]);
    await book.runTurn(open, { turnId: "t2", text: "again" }, 1);
    expect(book.runningTurns).toBe(0);
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

  it("starts Claude with the turn's maxTurns, and restarts it when the limit changes", async () => {
    const limits: (number | undefined)[] = [];
    const factory: QueryFactory = async (ctx) => {
      limits.push(ctx.maxTurns);
      for await (const turn of ctx.turns) {
        ctx.publish({ type: "turn_end", turnId: turn.turnId, stopReason: "end_turn" });
      }
    };
    const book = new SessionBook(factory, DEFAULT_TIMINGS);
    const open = (maxTurns?: number | "unlimited") => ({
      sessionId: "s",
      model: "claude-sonnet-4-6",
      tools: [] as const,
      ...(maxTurns ? { maxTurns } : {}),
    });
    await book.runTurn(open(), { turnId: "1", text: "a" }, 0);
    await book.runTurn(open(), { turnId: "2", text: "b" }, 1);
    await book.runTurn(open(250), { turnId: "3", text: "c" }, 2);
    await book.runTurn(open(250), { turnId: "4", text: "d" }, 3);
    await book.runTurn(open("unlimited"), { turnId: "5", text: "e" }, 4);
    expect(DEFAULT_TIMINGS.maxTurns).toBe(100);
    expect(limits).toEqual([100, 250, undefined]);
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
  it("fails queued turns when the process factory dies, instead of replaying them to the next process", async () => {
    const delivered: string[] = [];
    let attempts = 0;
    const factory: QueryFactory = async (ctx) => {
      attempts += 1;
      if (attempts === 1) throw new Error("claude binary missing");
      for await (const turn of ctx.turns) {
        delivered.push(turn.turnId);
        ctx.publish({ type: "turn_end", turnId: turn.turnId, stopReason: "end_turn" });
      }
    };
    const book = new SessionBook(factory, DEFAULT_TIMINGS);
    const open = { sessionId: "s", model: "claude-sonnet-4-6", tools: [] as const };

    await expect(book.runTurn(open, { turnId: "t1", text: "first" }, 0)).rejects.toThrow(
      /claude binary missing/,
    );
    expect(book.runningTurns).toBe(0);

    const session = await book.runTurn(open, { turnId: "t2", text: "second" }, 1);
    expect(session.alive).toBe(true);
    expect(delivered).toEqual(["t2"]);
  });

  it("fails a turn whose factory throws before the process starts, instead of replaying it", async () => {
    const delivered: string[] = [];
    let attempts = 0;
    const factory: QueryFactory = (ctx) => {
      attempts += 1;
      if (attempts === 1) throw new Error("claude binary missing");
      return (async () => {
        for await (const turn of ctx.turns) {
          delivered.push(turn.turnId);
          ctx.publish({ type: "turn_end", turnId: turn.turnId, stopReason: "end_turn" });
        }
      })();
    };
    const book = new SessionBook(factory, DEFAULT_TIMINGS);
    const open = { sessionId: "s", model: "claude-sonnet-4-6", tools: [] as const };

    await expect(book.runTurn(open, { turnId: "t1", text: "first" }, 0)).rejects.toThrow(
      /claude binary missing/,
    );

    const session = await book.runTurn(open, { turnId: "t2", text: "second" }, 1);
    expect(session.alive).toBe(true);
    expect(delivered).toEqual(["t2"]);
  });
});

describe("SDK lockdown", () => {
  it("passes an empty tool list and does not set a base URL", async () => {
    const seen: SdkQueryOptions[] = [];
    const sdk: ClaudeSdkModule = {
      query: (args) => {
        seen.push(args.options);
        return (async function* () {})();
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

  it("says where to raise the limit when Claude runs out of turns", async () => {
    const sdk: ClaudeSdkModule = {
      query: (args) =>
        (async function* () {
          for await (const _ of args.prompt) break;
          yield {
            type: "result",
            subtype: "error_max_turns",
            is_error: true,
            errors: ["Reached maximum number of turns (100)"],
          };
        })(),
      tool: (name) => ({ name }),
      createSdkMcpServer: (opts) => ({ name: opts.name, toolCount: opts.tools.length }),
    };
    const events: unknown[] = [];
    await createSdkQueryFactory(sdk, { PATH: "/usr/bin" })({
      model: "claude-sonnet-4-6",
      tools: [],
      signal: new AbortController().signal,
      turns: (async function* () {
        yield { turnId: "t", text: "browse" };
      })(),
      publish: (event) => events.push(event),
      callTool: async () => ({ content: "" }),
      setClaudeSessionId: () => undefined,
      maxTurns: 100,
    });
    expect(events).toContainEqual({
      type: "turn_end",
      turnId: "t",
      stopReason: "error",
      error:
        'Reached maximum number of turns (100). Raise "Max turns" in Settings → Models → Claude plan, then send a message to continue.',
    });
  });

  it("accepts a turn's maxTurns up to 1,000, or opt-in unlimited", () => {
    const turn = { type: "turn", sessionId: "s", turnId: "t", text: "hi", model: "m" };
    expect(parseClientMessage({ ...turn, maxTurns: 1_000 })).toMatchObject({ maxTurns: 1_000 });
    expect(parseClientMessage({ ...turn, maxTurns: "unlimited" })).toMatchObject({
      maxTurns: "unlimited",
    });
    expect(parseClientMessage({ ...turn, maxTurns: "lots" })).toBeUndefined();
    expect(parseClientMessage({ ...turn, maxTurns: 1_001 })).toBeUndefined();
    expect(parseClientMessage({ ...turn, maxTurns: 0 })).toBeUndefined();
  });

  it("sets no maxTurns at all when the turn has no limit", () => {
    const options = buildSdkOptions({
      model: "claude-sonnet-4-6",
      env: { PATH: "/usr/bin" },
      mcpServer: {},
      toolNames: [],
    });
    expect("maxTurns" in options).toBe(false);
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

    const run = (call: { toolUseId: string }) => {
      executions.push(call.toolUseId);
      return new Promise<{ content: string }>((resolve) => {
        release.go = resolve;
      });
    };
    const { client, events, sockets, connects } = botClient(server.url, { onTool: run });

    client.track("9");
    client.send({
      type: "turn",
      sessionId: "9",
      turnId: "turn-1",
      text: "search the tide",
      model: "claude-sonnet-4-6",
      tools: [{ name: "web_search", description: "Search", inputSchema: { type: "object" } }],
    });
    await vi.waitFor(() => expect(executions).toEqual(["toolu_once"]));
    sockets[0]?.terminate();
    await vi.waitFor(() => expect(connects).toEqual([false, false]));
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

  it("starts the 120s timer over on the app's tool_waiting", async () => {
    const armed: number[] = [];
    let cleared = 0;
    const query: QueryFactory = async (ctx) => {
      for await (const turn of ctx.turns) {
        await ctx.callTool({
          turnId: turn.turnId,
          toolUseId: "toolu_ask",
          name: "send_email",
          input: {},
        });
      }
    };
    const server = await createClaudeWorkerServer({
      token: TOKEN,
      query,
      authStatus: subscribed,
      env: {},
      timings: { ...fastTimings, toolResultTimeoutMs: 120_000 },
      arm: (_fn, ms) => {
        armed.push(ms);
        return () => {
          cleared += 1;
        };
      },
      port: 0,
    });
    servers.push(server);
    const { client } = botClient(server.url, { onTool: () => new Promise(() => undefined) });
    client.track("4");
    client.send({
      type: "turn",
      sessionId: "4",
      turnId: "ask",
      text: "mail ana",
      model: "claude-sonnet-4-6",
    });
    await vi.waitFor(() => expect(armed).toEqual([120_000]));
    client.send({ type: "tool_waiting", sessionId: "4", toolUseId: "toolu_ask" });
    await vi.waitFor(() => expect(armed).toEqual([120_000, 120_000]));
    expect(cleared).toBe(1);
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
    const { client, events } = botClient(server.url, {
      onTool: () => new Promise(() => undefined),
    });
    client.track("3");
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

describe("the worker's side of the envelope", () => {
  it("greets with its boot id, and answers a bot resume before replaying", async () => {
    const query: QueryFactory = async (ctx) => {
      for await (const turn of ctx.turns) {
        ctx.publish({ type: "text", turnId: turn.turnId, text: "one" });
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
    const frames: Array<Record<string, unknown>> = [];
    const ws = new WebSocket(server.url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    ws.on("message", (data) => frames.push(JSON.parse(String(data)) as Record<string, unknown>));
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));
    clients.push({ close: () => ws.close() });
    await vi.waitFor(() => expect(frames[0]).toMatchObject({ type: "welcome" }));
    expect(frames[0]?.bootId).toEqual(expect.any(String));

    const send = (frame: Record<string, unknown>) => ws.send(JSON.stringify(frame));
    send({ type: "resume", requestId: "q1", sessionId: "5", afterSeq: 0 });
    await vi.waitFor(() =>
      expect(frames.find((frame) => frame.requestId === "q1")).toMatchObject({
        type: "reply",
        ok: true,
        result: { known: false, gap: false, firstSeq: 1, lastSeq: 0 },
      }),
    );
    send({ type: "turn", sessionId: "5", turnId: "t1", text: "hi", model: "claude-sonnet-4-6" });
    await vi.waitFor(() =>
      expect(frames.filter((frame) => frame.type === "event")).toHaveLength(2),
    );
    frames.length = 0;
    send({ type: "resume", requestId: "q2", sessionId: "5", afterSeq: 1 });
    await vi.waitFor(() => expect(frames).toHaveLength(2));
    expect(frames[0]).toMatchObject({
      type: "reply",
      requestId: "q2",
      result: { known: true, gap: false, firstSeq: 1, lastSeq: 2 },
    });
    expect(frames[1]).toMatchObject({ type: "event", sessionId: "5", seq: 2 });
  });
});

describe("bot engine while a call waits on the owner", () => {
  const runtimes: { close: () => Promise<void> }[] = [];
  afterEach(async () => {
    await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
  });

  it("tells the worker the call still waits, well inside its tool timeout", async () => {
    expect(OWNER_WAIT_KEEPALIVE_MS * 3).toBeLessThan(DEFAULT_TIMINGS.toolResultTimeoutMs);
    const engine = await openEngine("claude-code", { capabilities: [mailCapability([])] });
    runtimes.push(engine.runtime);
    const ref = await engine.runtime.createConversation({
      modelId: engine.modelId,
      systemPrompt: "Be brief.",
      capabilities: { enabled: ["mail"], permissions: {} },
    });
    const chat = await watch(engine.runtime, ref);
    await engine.send(ref, { requestId: "r1", text: "send_email ana@x.dev" });
    const waiting = await awaitingApproval(chat, "send_email");
    await until(() => engine.worker.waiting.length > 0, "the first tool_waiting");
    expect(engine.worker.waiting).toEqual(["toolu_1"]);
    await engine.runtime.decideApproval(ref, waiting.taskId!, "approved");
    await until(() => engine.worker.ended.includes("r1"), "the turn to end");
    expect(engine.worker.waiting).toEqual(["toolu_1"]);
    await chat.stop();
  }, 15_000);
});

describe("bot engine on a worker restart", () => {
  const runtimes: { close: () => Promise<void> }[] = [];
  afterEach(async () => {
    await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
    vi.unstubAllEnvs();
  });

  it("ends the turn the old worker was running, and sends a waiting one to the new worker", async () => {
    const engine = await openEngine("claude-code", { capabilities: [mailCapability([])] });
    runtimes.push(engine.runtime);
    const config = {
      modelId: engine.modelId,
      systemPrompt: "Be brief.",
      capabilities: { enabled: ["mail"], permissions: {} },
    };
    const running = await engine.runtime.createConversation(config);
    const waiting = await engine.runtime.createConversation(config);
    const last = async (ref: number): Promise<ChatMessage | undefined> =>
      (await engine.runtime.readChat(ref)).messages.at(-1);

    engine.worker.hold();
    await engine.send(running, { requestId: "r1", text: "hello" });
    await until(() => engine.worker.turns.length === 1, "the worker to get the turn");
    expect(engine.runtime.isBusy(running)).toBe(true);

    engine.worker.restart();
    await engine.send(waiting, { requestId: "r2", text: "still there?" });

    const cut = await until(async () => {
      const message = await last(running);
      return message?.status === "error" ? message : undefined;
    }, "the cut-off turn to end");
    expect(cut.error).toBe(WORKER_RESTARTED);
    expect(engine.runtime.isBusy(running)).toBe(false);
    const answered = await until(async () => {
      const message = await last(waiting);
      return message?.status === "done" ? message : undefined;
    }, "the waiting turn's reply");
    expect(answered.text).toBe("Echo: still there?");
    expect(answered.error).toBeUndefined();

    await engine.send(running, { requestId: "r3", text: "again" });
    const again = await until(async () => {
      const message = await last(running);
      return message?.status === "done" ? message : undefined;
    }, "the next reply");
    expect(again.text).toBe("Echo: again");
  }, 15_000);
});

describe("a tool that throws on the Claude plan engine", () => {
  const runtimes: { close: () => Promise<void> }[] = [];
  afterEach(async () => {
    await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
    secretRedactor.clear();
  });

  function throwingCapability(secret: string): Capability {
    const boom = defineTool({
      name: "read_token",
      description: "Read the deploy token",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async () => {
        throw new Error(`deploy failed: token=${secret}`);
      },
    });
    return {
      id: "mail",
      kind: "toolkit",
      name: "Mail",
      description: "Email",
      extension: defineExtension({ name: "mail", tools: [boom] }),
      tools: [{ name: "read_token", label: "Read token", description: "Token", readOnly: true }],
    };
  }

  it("scrubs a thrown tool error before the model reads it", async () => {
    secretRedactor.register(VAULT_VALUE);
    const engine = await openEngine("claude-code", {
      capabilities: [throwingCapability(VAULT_VALUE)],
    });
    runtimes.push(engine.runtime);
    const ref = await engine.runtime.createConversation({
      modelId: engine.modelId,
      systemPrompt: "Be brief.",
      capabilities: { enabled: ["mail"], permissions: {} },
    });
    const chat = await watch(engine.runtime, ref);
    await engine.send(ref, { requestId: "r1", text: "read_token" });
    expect(await until(() => chat.results()[0], "the reply")).toBe("deploy failed: token=[vault]");
    expect(JSON.stringify(engine.worker.results)).not.toContain(VAULT_VALUE);
    expect(JSON.stringify(chat.state())).not.toContain(VAULT_VALUE);
    await chat.stop();
  }, 15_000);
});
