/**
 * Claude plan engine and worker: the bot protocol. No network except a
 * localhost WebSocket with an injected SDK. Nothing here calls Anthropic.
 * The socket policy under it (heartbeat, reconnect, resume, reboot) is
 * tested once, in claude-worker-connection.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { WebSocket } from "ws";
import {
  ClaudeWorkerClient,
  type WebSocketLike,
} from "../../../../packages/agent/src/engines/claude-code/client";
import { WORKER_RESTARTED } from "../../../../packages/agent/src/engines/claude-code/engine";
import type { ChatMessage } from "../../../../packages/agent/src/types";
import { mailCapability, openEngine, until } from "./engine-harness";
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

/** The bot protocol on a real socket to `url`, keeping each socket so a test can drop one. */
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
    // Sent while the socket is down: it waits for the next worker.
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

    // The conversation that was cut off carries on with the new worker.
    await engine.send(running, { requestId: "r3", text: "again" });
    const again = await until(async () => {
      const message = await last(running);
      return message?.status === "done" ? message : undefined;
    }, "the next reply");
    expect(again.text).toBe("Echo: again");
  }, 15_000);
});
