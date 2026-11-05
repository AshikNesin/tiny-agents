/**
 * The worker's coding mode (the Code page's Claude Code threads): protocol,
 * SDK options, its own caps, the login check and path checks, and that the
 * bot protocol on the same socket is unchanged. A localhost WebSocket and an
 * injected SDK; nothing here calls Anthropic.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { WebSocket } from "ws";
import {
  DEFAULT_CODING_LIMITS,
  DEFAULT_TIMINGS,
  OverrideRefusal,
  buildCodingSdkOptions,
  codingLimitsFromEnv,
  createClaudeWorkerServer,
  isCodingMessage,
  parseClientMessage,
  parseCodingClientMessage,
  questionAnswers,
  repoRelative,
  safeFilename,
  type CodingLimits,
  type QueryFactory,
} from "../../../../packages/claude-worker/src/index";
import { mimeTypeOf } from "../../../../packages/claude-worker/src/coding-ops";
import { FakeSdk, echo, manual, type Brain } from "../../code/claude-code/fake-sdk";

const TOKEN = Buffer.alloc(32, 5).toString("base64");
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const timings = { ...DEFAULT_TIMINGS, pingIntervalMs: 60_000, silenceCloseMs: 180_000 };
const subscribed = () =>
  Promise.resolve({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" });

interface Socket {
  ws: WebSocket;
  messages: Array<Record<string, unknown>>;
  request: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  send: (body: Record<string, unknown>) => void;
}

async function connect(url: string): Promise<Socket> {
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const messages: Array<Record<string, unknown>> = [];
  ws.on("message", (data) => messages.push(JSON.parse(String(data)) as Record<string, unknown>));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  cleanups.push(() => ws.close());
  const send = (body: Record<string, unknown>) => ws.send(JSON.stringify(body));
  return {
    ws,
    messages,
    send,
    request: async (body) => {
      const requestId = randomUUID();
      send({ ...body, requestId });
      return vi.waitFor(() => {
        const reply = messages.find(
          (message) => message.type === "reply" && message.requestId === requestId,
        );
        if (!reply) throw new Error("no reply yet");
        return reply;
      });
    },
  };
}

async function server(
  options: {
    brain?: Brain;
    limits?: Partial<CodingLimits>;
    authStatus?: () => Promise<{
      loggedIn: boolean;
      authMethod?: string;
      subscriptionType?: string;
    }>;
    coding?: boolean;
    query?: QueryFactory;
  } = {},
) {
  const sdk = new FakeSdk(options.brain ?? echo);
  const dir = await mkdtemp(path.join(tmpdir(), "worker-coding-"));
  const worker = await createClaudeWorkerServer({
    token: TOKEN,
    query: options.query ?? (async () => undefined),
    authStatus: options.authStatus ?? subscribed,
    env: {},
    timings,
    port: 0,
    ...(options.coding === false
      ? {}
      : {
          coding: {
            sdk,
            limits: { ...DEFAULT_CODING_LIMITS, ...options.limits },
            uploadsDir: path.join(dir, "uploads"),
            home: dir,
          },
        }),
  });
  cleanups.push(async () => {
    await worker.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { worker, sdk, dir };
}

const session = (cwd: string) => ({ cwd });

describe("coding protocol", () => {
  it("parses coding requests strictly and leaves the bot protocol alone", () => {
    const send = {
      type: "coding.send",
      requestId: "r1",
      sessionId: "thread_1",
      session: { cwd: "/repo", permissionMode: "acceptEdits" },
      uuid: randomUUID(),
      text: "hello",
      mode: "steer",
    };
    expect(parseCodingClientMessage(send)?.type).toBe("coding.send");
    expect(parseCodingClientMessage({ ...send, uuid: "not-a-uuid" })).toBeUndefined();
    expect(parseCodingClientMessage({ ...send, mode: "now" })).toBeUndefined();
    expect(
      parseCodingClientMessage({ ...send, session: { cwd: "/r", permissionMode: "dontAsk" } }),
    ).toBeUndefined();
    expect(
      parseCodingClientMessage({
        type: "coding.op",
        requestId: "r",
        op: { op: "git_files", cwd: "/repo", diffId: "HEAD; rm -rf /" },
      }),
    ).toBeUndefined();
    expect(
      parseCodingClientMessage({
        type: "coding.op",
        requestId: "r",
        op: { op: "shell", command: "ls" },
      }),
    ).toBeUndefined();
    expect(isCodingMessage(send)).toBe(true);
    expect(isCodingMessage({ type: "turn" })).toBe(false);
    // A coding message is not a bot message.
    expect(parseClientMessage(send)).toBeUndefined();
  });

  it("has its own caps, configurable by env", () => {
    expect(DEFAULT_CODING_LIMITS.maxLiveProcesses).toBe(3);
    expect(DEFAULT_CODING_LIMITS.maxRunningTurns).toBe(2);
    expect(
      codingLimitsFromEnv({
        CLAUDE_WORKER_CODING_MAX_PROCESSES: "5",
        CLAUDE_WORKER_CODING_MAX_TURNS: "4",
        CLAUDE_WORKER_MAX_PROCESSES: "1",
      }),
    ).toMatchObject({ maxLiveProcesses: 5, maxRunningTurns: 4 });
    expect(codingLimitsFromEnv({ CLAUDE_WORKER_CODING_MAX_TURNS: "zero" }).maxRunningTurns).toBe(2);
  });

  it("builds SDK options with Claude Code's tools and settings, and no overrides", () => {
    const canUseTool = async () => ({ behavior: "deny" as const, message: "no" });
    const options = buildCodingSdkOptions({
      cwd: "/repo",
      env: { PATH: "/usr/bin", HOME: "/home/u" },
      canUseTool,
    });
    expect(options).toMatchObject({
      cwd: "/repo",
      permissionMode: "acceptEdits",
      tools: { type: "preset", preset: "claude_code" },
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
    });
    expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    expect("ANTHROPIC_BASE_URL" in options.env).toBe(false);
    expect(options.env.CLAUDE_CODE_MAX_RETRIES).toBe("0");
    expect(
      buildCodingSdkOptions({
        cwd: "/repo",
        env: {},
        canUseTool,
        permissionMode: "bypassPermissions",
        resume: "abc",
        model: "opus",
        effort: "max",
      }),
    ).toMatchObject({
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      resume: "abc",
      model: "opus",
      effort: "max",
    });
    expect(() =>
      buildCodingSdkOptions({ cwd: "/r", env: { ANTHROPIC_BASE_URL: "http://x" }, canUseTool }),
    ).toThrow(OverrideRefusal);
    expect(() =>
      buildCodingSdkOptions({ cwd: "/r", env: { ANTHROPIC_API_KEY: "sk-ant-api" }, canUseTool }),
    ).toThrow(OverrideRefusal);
  });

  it("keys AskUserQuestion answers by question text", () => {
    const input = {
      questions: [
        { question: "Which database?", header: "DB", options: [] },
        { question: "Which ORM?", header: "ORM", options: [] },
      ],
    };
    expect(questionAnswers(input, { DB: "SQLite", "1": "Drizzle", stray: "x" })).toEqual({
      "Which database?": "SQLite",
      "Which ORM?": "Drizzle",
    });
  });

  it("checks paths before git or fs sees them", () => {
    expect(repoRelative("src/a.ts")).toBe("src/a.ts");
    expect(repoRelative("src/../a.ts")).toBe("a.ts");
    expect(() => repoRelative("../secret")).toThrow();
    expect(() => repoRelative("src/../../secret")).toThrow();
    expect(() => repoRelative("/etc/passwd")).toThrow();
    expect(() => repoRelative("--output=/tmp/x")).toThrow();
    expect(() => repoRelative("a\0b")).toThrow();
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename(".bashrc")).toBe("_bashrc");
    expect(safeFilename("my file (1).png")).toBe("my file _1_.png");
  });

  it("serves the image types the Code page shows inline", () => {
    expect(mimeTypeOf("/tmp/shot.avif")).toBe("image/avif");
    expect(mimeTypeOf("/tmp/shot.WEBP")).toBe("image/webp");
    expect(mimeTypeOf("/tmp/notes.bin")).toBe("application/octet-stream");
  });
});

describe("coding mode on the worker socket", () => {
  it("answers unavailable when the worker runs without coding mode", async () => {
    const { worker } = await server({ coding: false });
    const socket = await connect(worker.url);
    const reply = await socket.request({ type: "coding.hello" });
    expect(reply).toMatchObject({ ok: false, error: { code: "unavailable" } });
    const bad = await socket.request({ type: "coding.nope" });
    expect(bad).toMatchObject({ ok: false, error: { code: "bad_message" } });
  });

  it("checks the subscription login before a coding process starts", async () => {
    const { worker, sdk, dir } = await server({
      authStatus: async () => ({ loggedIn: true, authMethod: "api_key", subscriptionType: "max" }),
    });
    const socket = await connect(worker.url);
    const reply = await socket.request({
      type: "coding.send",
      sessionId: "t1",
      session: session(dir),
      uuid: randomUUID(),
      text: "hi",
      mode: "steer",
    });
    expect(reply).toMatchObject({ ok: false, error: { code: "auth" } });
    expect(sdk.queries).toHaveLength(0);
  });

  it("streams events only to coding sockets, and keeps bot turns working", async () => {
    const bot: QueryFactory = async (ctx) => {
      for await (const turn of ctx.turns) {
        ctx.publish({ type: "text", turnId: turn.turnId, text: "bot answer" });
        ctx.publish({ type: "turn_end", turnId: turn.turnId, stopReason: "end_turn" });
      }
    };
    const { worker, dir } = await server({ query: bot });
    const coding = await connect(worker.url);
    const botSocket = await connect(worker.url);
    const hello = await coding.request({ type: "coding.hello" });
    expect(hello).toMatchObject({ ok: true, result: { bootId: expect.any(String), sessions: [] } });

    const reply = await coding.request({
      type: "coding.send",
      sessionId: "t1",
      session: session(dir),
      uuid: randomUUID(),
      text: "hi",
      mode: "steer",
    });
    expect(reply).toMatchObject({ ok: true, result: { status: "accepted" } });
    await vi.waitFor(() =>
      expect(
        coding.messages.some(
          (message) =>
            message.type === "coding.event" &&
            (message.event as { type: string; message?: { type?: string } }).message?.type ===
              "result",
        ),
      ).toBe(true),
    );
    expect(coding.messages.some((message) => message.type === "coding.partial")).toBe(true);

    botSocket.send({
      type: "turn",
      sessionId: "7",
      turnId: "turn-1",
      text: "hello bot",
      model: "claude-sonnet-4-6",
    });
    await vi.waitFor(() =>
      expect(
        botSocket.messages.some(
          (message) =>
            message.type === "event" && (message.event as { type: string }).type === "turn_end",
        ),
      ).toBe(true),
    );
    expect(botSocket.messages.some((message) => String(message.type).startsWith("coding."))).toBe(
      false,
    );
  });

  it("dedupes a retried send by its uuid", async () => {
    const { worker, sdk, dir } = await server({ brain: manual });
    const socket = await connect(worker.url);
    const body = {
      type: "coding.send",
      sessionId: "t1",
      session: session(dir),
      uuid: randomUUID(),
      text: "only once",
      mode: "steer",
    };
    await socket.request(body);
    await socket.request(body);
    const query = await vi.waitFor(() => {
      const found = sdk.queries[0];
      if (!found) throw new Error("no query");
      return found;
    });
    await query.nextInput();
    await socket.request({ type: "coding.interrupt", sessionId: "t1" });
    expect(query.received.map((input) => input.message.content)).toEqual(["only once"]);
  });

  it("reports a gap when the replay buffer no longer holds the asked events", async () => {
    const { worker, dir } = await server({ limits: { eventBuffer: 3 } });
    const socket = await connect(worker.url);
    await socket.request({ type: "coding.hello" });
    await socket.request({
      type: "coding.send",
      sessionId: "t1",
      session: session(dir),
      uuid: randomUUID(),
      text: "make some events",
      mode: "steer",
    });
    await vi.waitFor(() =>
      expect(
        socket.messages.filter((message) => message.type === "coding.event").length,
      ).toBeGreaterThan(4),
    );
    const resume = await socket.request({ type: "coding.resume", sessionId: "t1", afterSeq: 0 });
    expect(resume).toMatchObject({ ok: true, result: { known: true, gap: true } });
    const { firstSeq, lastSeq } = resume.result as { firstSeq: number; lastSeq: number };
    expect(lastSeq - firstSeq).toBe(2);
    const unknown = await socket.request({ type: "coding.resume", sessionId: "nope", afterSeq: 4 });
    expect(unknown).toMatchObject({ ok: true, result: { known: false, gap: false } });
  });

  it("refuses a second running turn beyond the coding cap without touching bot caps", async () => {
    const { worker, dir } = await server({ brain: manual, limits: { maxRunningTurns: 1 } });
    const socket = await connect(worker.url);
    const first = await socket.request({
      type: "coding.send",
      sessionId: "a",
      session: session(dir),
      uuid: randomUUID(),
      text: "a",
      mode: "steer",
    });
    expect(first).toMatchObject({ ok: true });
    const second = await socket.request({
      type: "coding.send",
      sessionId: "b",
      session: session(dir),
      uuid: randomUUID(),
      text: "b",
      mode: "steer",
    });
    expect(second).toMatchObject({ ok: false, error: { code: "turn_busy" } });
  });
});
