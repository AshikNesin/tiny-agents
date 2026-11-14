/**
 * The Claude Code harness against an in-process worker (coding mode) with a
 * scripted Agent SDK. Real WebSockets on loopback; nothing calls Anthropic.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_CODING_LIMITS,
  DEFAULT_TIMINGS,
  createClaudeWorkerServer,
  type ClaudeWorkerServer,
  type CodingLimits,
  type Timings,
} from "../../../../packages/claude-worker/src/index";
import { createClaudeCodeHarness, HarnessError } from "../../../../packages/code/src/server/index";
import { createCodeHub, setCodeHub } from "../../../../apps/web/src/server/api/code/code.hub";
import { api, createTestApp } from "../../helpers";
import { authToken } from "../../fixtures";
import type { ClaudeCodeHarness } from "../../../../packages/code/src/drivers/claude-code";
import type {
  HarnessHost,
  InstanceEvent,
  TranscriptItem,
} from "../../../../packages/code/src/contracts";
import {
  capabilityProblems,
  collect,
  testHost,
  threadEventProblems,
} from "../../../../packages/code/src/testing";
import {
  FakeSdk,
  delta,
  echo,
  manual,
  result,
  text,
  toolResult,
  toolUse,
  type Brain,
  type FakeQuery,
} from "./fake-sdk";
import { describeTurnOutcomeRule, type TurnCase } from "../turn-outcome-conformance";

const TOKEN = Buffer.alloc(32, 9).toString("base64");
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const timings: Timings = {
  ...DEFAULT_TIMINGS,
  pingIntervalMs: 60_000,
  silenceCloseMs: 180_000,
};

function subscribed() {
  return Promise.resolve({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" });
}

interface Setup {
  sdk: FakeSdk;
  server: ClaudeWorkerServer;
  host: HarnessHost;
  harness: ClaudeCodeHarness;
  dir: string;
  events: InstanceEvent[];
}

async function startServer(sdk: FakeSdk, dir: string, limits: Partial<CodingLimits> = {}) {
  return createClaudeWorkerServer({
    token: TOKEN,
    query: async () => undefined,
    authStatus: subscribed,
    env: {},
    timings,
    port: 0,
    coding: {
      sdk,
      limits: { ...DEFAULT_CODING_LIMITS, stopGraceMs: 5_000, ...limits },
      uploadsDir: path.join(dir, ".uploads"),
      home: dir,
    },
  });
}

async function setup(
  brain: Brain,
  options: { limits?: Partial<CodingLimits>; host?: HarnessHost } = {},
): Promise<Setup> {
  const sdk = new FakeSdk(brain);
  const dir = await mkdtemp(path.join(tmpdir(), "claude-code-"));
  let server = await startServer(sdk, dir, options.limits);
  const host = options.host ?? testHost();
  const harness = createClaudeCodeHarness({
    host,
    resolveWorker: async () => ({ url: server.url, token: TOKEN }),
    timings: { reconnectMinMs: 10, reconnectMaxMs: 40, requestTimeoutMs: 5_000 },
  });
  const events: InstanceEvent[] = [];
  harness.subscribe((event) => events.push(event));
  harness.start();
  const result: Setup = { sdk, server, host, harness, dir, events };
  Object.defineProperty(result, "server", {
    get: () => server,
    set: (next: ClaudeWorkerServer) => {
      server = next;
    },
  });
  cleanups.push(async () => {
    harness.stop();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
  return result;
}

async function queryOf(sdk: FakeSdk, index = 0): Promise<FakeQuery> {
  return vi.waitFor(() => {
    const query = sdk.queries[index];
    if (!query) throw new Error("no query yet");
    return query;
  });
}

function turnEnds(events: InstanceEvent[]) {
  return events.filter(
    (event): event is Extract<InstanceEvent, { type: "turn_ended" }> => event.type === "turn_ended",
  );
}

async function waitTurnEnds(events: InstanceEvent[], count: number) {
  await vi.waitFor(() => expect(turnEnds(events).length).toBeGreaterThanOrEqual(count));
  return turnEnds(events);
}

function kinds(items: TranscriptItem[]): string[] {
  return items.map((item) =>
    item.kind === "notice"
      ? `notice:${item.text}`
      : item.kind === "user" || item.kind === "assistant"
        ? `${item.kind}:${item.text}`
        : item.kind,
  );
}

async function attention(events: InstanceEvent[], index = 0) {
  return vi.waitFor(() => {
    const asks = events.filter(
      (event): event is Extract<InstanceEvent, { type: "attention" }> => event.type === "attention",
    );
    const ask = asks[index];
    if (!ask) throw new Error("no attention yet");
    return ask;
  });
}

describe("Claude Code harness", () => {
  it("offers the Claude plan's models, and nothing hardcoded before Claude Code reports any", async () => {
    const { harness, host } = await setup(manual);
    // No session yet and no plan models: no invented list ("Default" is the picker's own).
    expect(await harness.models()).toEqual([]);
    const plan = [{ id: "claude-opus-5-5", label: "Claude Opus 5.5", supportsReasoning: true }];
    const withPlan = createClaudeCodeHarness({
      host,
      resolveWorker: async () => ({ url: "ws://127.0.0.1:1", token: TOKEN }),
      models: () => plan,
    });
    cleanups.push(() => withPlan.stop());
    expect(await withPlan.models()).toEqual(plan);
  });

  it("is honest about its capabilities", async () => {
    const { harness } = await setup(manual);
    expect(capabilityProblems(harness)).toEqual([]);
    expect(harness.kind).toBe("claude-code");
    expect(harness.label).toBe("Claude Code");
    const caps = harness.capabilities();
    expect(caps.settings.defaultPermissionMode).toBe("acceptEdits");
    expect(caps.threads.discover).toBe(false);
    expect(caps.workspace.requiresCwd).toBe(true);
    expect(caps.turns.steer).toBe(true);
    await vi.waitFor(() => expect(harness.status().state).toBe("connected"));
  });

  it("runs a simple turn in the thread's cwd, acceptEdits, with Claude Code's own tools", async () => {
    const { harness, sdk, dir, events } = await setup(echo);
    const { nativeId } = await harness.createThread({
      message: "  hello there\nsecond line",
      cwd: dir,
    });
    expect(nativeId).toMatch(/^[A-Za-z0-9_-]+$/);
    const [ended] = await waitTurnEnds(events, 1);
    expect(ended).toMatchObject({
      nativeId,
      outcome: { working: false, failed: false, text: "Echo:   hello there\nsecond line" },
    });

    const query = sdk.queries[0]!;
    expect(query.options).toMatchObject({
      cwd: dir,
      permissionMode: "acceptEdits",
      tools: { type: "preset", preset: "claude_code" },
      systemPrompt: { type: "preset", preset: "claude_code" },
      includePartialMessages: true,
    });
    expect(query.options.settingSources).toContain("project");
    expect(query.options.resume).toBeUndefined();
    expect(query.options.allowDangerouslySkipPermissions).toBeUndefined();
    expect("ANTHROPIC_BASE_URL" in query.options.env).toBe(false);
    expect(query.options.env.CLAUDE_CODE_MAX_RETRIES).toBe("0");

    const snapshot = await harness.getThread(nativeId);
    expect(snapshot.thread).toMatchObject({
      id: `claude-code:${nativeId}`,
      title: "hello there",
      cwd: dir,
      working: false,
      permissionMode: "acceptEdits",
      cursor: 1,
    });
    expect(kinds(snapshot.items)).toEqual([
      "user:  hello there\nsecond line",
      "assistant:Echo:   hello there\nsecond line",
      "turn",
    ]);
    expect(snapshot.items.at(-1)).toMatchObject({ kind: "turn", durationMs: 1500, costUsd: 0.01 });
    expect(snapshot.costUsd).toBeCloseTo(0.01);
    expect(snapshot.context).toEqual({ used: 16280, max: 200000 });

    const outcome = await harness.outcome(nativeId);
    expect(outcome).toMatchObject({
      working: false,
      failed: false,
      text: "Echo:   hello there\nsecond line",
      cursor: 1,
    });
    const list = await harness.listThreads("active");
    expect(list.map((thread) => thread.nativeId)).toEqual([nativeId]);
    const usage = await harness.usage!(nativeId);
    expect(usage.models[0]).toMatchObject({ label: "claude-opus-4-7", priced: true });
    expect(usage.totalUsd).toBeCloseTo(0.01);
    // supportedCommands / supportedModels were cached from the first session.
    await vi.waitFor(() =>
      expect(harness.commands!().map((command) => command.command)).toContain("/review"),
    );
    expect((await harness.models()).map((model) => model.id)).toEqual(["default", "sonnet"]);
  });

  it("streams a watched turn: partial text, rows, then idle", async () => {
    const { harness, sdk, dir } = await setup(manual);
    const { nativeId } = await harness.createThread({ message: "explain", cwd: dir });
    const query = await queryOf(sdk);
    await query.nextInput();
    const watch = collect();
    const stop = harness.watchThread(nativeId, watch.listener);
    cleanups.push(stop);
    const first = await watch.next((event) => event.type === "snapshot");
    if (first.type !== "snapshot") throw new Error("no snapshot");
    expect(kinds(first.snapshot.items)).toEqual(["user:explain"]);
    expect(first.snapshot.thread.working).toBe(true);

    query.emit(delta(query, "Thinking it over", "thinking"));
    query.emit(delta(query, "It "));
    query.emit(delta(query, "works"));
    const partial = await watch.next(
      (event) => event.type === "partial" && event.text === "It works",
    );
    expect(partial).toEqual({ type: "partial", text: "It works", thinking: "Thinking it over" });
    query.emit(text(query, "It works."));
    const rows = await watch.next((event) => event.type === "items");
    if (rows.type !== "items") throw new Error("no rows");
    expect(kinds(rows.items)).toContain("assistant:It works.");
    query.emit(result(query, { totalCost: 0.02 }));
    await watch.next(
      (event) => event.type === "items" && event.items.some((item) => item.kind === "turn"),
    );
    const idle = await watch.next((event) => event.type === "state" && !event.working);
    expect(idle).toMatchObject({ costUsd: 0.02, context: { max: 200000 } });
    expect(threadEventProblems(watch.events)).toEqual([]);
  });

  it("runs several turns on one process, with per-turn cost", async () => {
    const { harness, sdk, dir, events } = await setup(echo);
    const { nativeId } = await harness.createThread({ message: "one", cwd: dir });
    await waitTurnEnds(events, 1);
    await expect(harness.send(nativeId, { message: "two" })).resolves.toEqual({
      status: "accepted",
    });
    await waitTurnEnds(events, 2);
    expect(sdk.queries).toHaveLength(1);
    const snapshot = await harness.getThread(nativeId);
    expect(kinds(snapshot.items)).toEqual([
      "user:one",
      "assistant:Echo: one",
      "turn",
      "user:two",
      "assistant:Echo: two",
      "turn",
    ]);
    const turns = snapshot.items.filter((item) => item.kind === "turn");
    expect(turns.map((turn) => (turn.kind === "turn" ? turn.costUsd : 0))).toEqual([0.01, 0.01]);
    expect(snapshot.costUsd).toBeCloseTo(0.02);
    expect(snapshot.thread.cursor).toBe(2);
  });

  it("holds a queued message until the turn ends, and can cancel one", async () => {
    const { harness, sdk, dir, events } = await setup(manual);
    const { nativeId } = await harness.createThread({ message: "first", cwd: dir });
    const query = await queryOf(sdk);
    await query.nextInput();
    await expect(harness.send(nativeId, { message: "second", queue: true })).resolves.toEqual({
      status: "queued",
    });
    await harness.send(nativeId, { message: "never", queue: true });
    const snapshot = await vi.waitFor(async () => {
      const snap = await harness.getThread(nativeId);
      expect(snap.queued.map((item) => item.text)).toEqual(["second", "never"]);
      return snap;
    });
    expect(snapshot.thread.queuedCount).toBe(2);
    await harness.queued!(nativeId, "cancel", snapshot.queued[1]!.id);
    await vi.waitFor(async () =>
      expect((await harness.getThread(nativeId)).queued.map((item) => item.text)).toEqual([
        "second",
      ]),
    );
    expect(query.received).toHaveLength(1);

    query.emit(text(query, "done with first"));
    query.emit(result(query, { totalCost: 0.01 }));
    const next = await query.nextInput();
    expect(next?.message.content).toBe("second");
    expect(next?.priority).toBeUndefined();
    query.emit(text(query, "done with second"));
    query.emit(result(query, { totalCost: 0.02 }));
    await waitTurnEnds(events, 2);
    const after = await harness.getThread(nativeId);
    expect(after.queued).toEqual([]);
    expect(kinds(after.items)).toEqual([
      "user:first",
      "assistant:done with first",
      "turn",
      "user:second",
      "assistant:done with second",
      "turn",
    ]);
  });

  it("steers a running turn: the message goes into the live query with priority next", async () => {
    const { harness, sdk, dir, events } = await setup(manual);
    const { nativeId } = await harness.createThread({ message: "refactor the parser", cwd: dir });
    const query = await queryOf(sdk);
    await query.nextInput();
    query.emit(toolUse(query, "toolu_read", "Read", { file_path: `${dir}/parser.ts` }));
    await expect(harness.send(nativeId, { message: "keep the old API" })).resolves.toEqual({
      status: "accepted",
    });
    const steer = await query.nextInput();
    expect(steer).toMatchObject({ priority: "next", message: { content: "keep the old API" } });
    query.emit(toolResult(query, "toolu_read", "export function parse() {}"));
    query.emit(text(query, "Keeping the old API."));
    // The CLI ran the steer in its own turn: still working after the first result,
    // and the steer belongs to the turn it went into, so no turn end yet.
    query.emit(result(query, { totalCost: 0.01, queuedTurnCount: 1 }));
    await vi.waitFor(async () => expect((await harness.getThread(nativeId)).thread.cursor).toBe(1));
    expect((await harness.outcome(nativeId)).working).toBe(true);
    expect(turnEnds(events)).toEqual([]);
    query.emit(text(query, "All done."));
    query.emit(result(query, { totalCost: 0.015 }));
    const [ended] = await waitTurnEnds(events, 1);
    expect(ended?.outcome).toMatchObject({ working: false, text: "All done." });
    expect(turnEnds(events)).toHaveLength(1);
    const snapshot = await harness.getThread(nativeId);
    expect(kinds(snapshot.items)).toEqual([
      "user:refactor the parser",
      "tool",
      "user:keep the old API",
      "assistant:Keeping the old API.",
      "turn",
      "assistant:All done.",
      "turn",
    ]);
    expect(sdk.queries).toHaveLength(1);
  });

  it("interrupts a running turn", async () => {
    const { harness, sdk, dir, events } = await setup(manual);
    const { nativeId } = await harness.createThread({ message: "run the tests", cwd: dir });
    const query = await queryOf(sdk);
    await query.nextInput();
    query.emit(toolUse(query, "toolu_sleep", "Bash", { command: "pnpm test" }));
    const interrupted = query.waitInterrupt();
    await harness.interrupt(nativeId);
    await interrupted;
    query.emit(
      toolResult(query, "toolu_sleep", "[Request interrupted by user for tool use]", {
        isError: true,
      }),
    );
    query.emit({
      type: "user",
      uuid: randomUUID(),
      session_id: query.sessionId,
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [{ type: "text", text: "[Request interrupted by user for tool use]" }],
      },
    });
    query.emit(result(query, { totalCost: 0.01, isError: true, errors: ["Request was aborted."] }));
    const [ended] = await waitTurnEnds(events, 1);
    expect(ended?.outcome).toMatchObject({ failed: false, text: "" });
    const snapshot = await harness.getThread(nativeId);
    expect(kinds(snapshot.items)).toEqual([
      "user:run the tests",
      "tool",
      "notice:Stopped.",
      "turn",
    ]);
    expect(snapshot.thread.working).toBe(false);
    expect(query.interrupts).toBe(1);
  });

  it("stops a turn before Claude Code read the prompt, without interrupting anything", async () => {
    const { harness, sdk, dir, events } = await setup(manual);
    const { nativeId } = await harness.createThread({ message: "too soon", cwd: dir });
    const query = await queryOf(sdk);
    await harness.interrupt(nativeId);
    await waitTurnEnds(events, 1);
    expect(query.interrupts).toBe(0);
    expect(query.received).toHaveLength(0);
    expect((await harness.outcome(nativeId)).working).toBe(false);
    // The next prompt is the first one Claude Code reads.
    await harness.send(nativeId, { message: "now go" });
    const next = await query.nextInput();
    expect(next?.message.content).toBe("now go");
    const snapshot = await harness.getThread(nativeId);
    expect(kinds(snapshot.items).slice(0, 3)).toEqual(["user:too soon", "notice:Stopped.", "turn"]);
  });

  it("repeats a stop that landed before the turn armed (older CLIs drop it)", async () => {
    const { harness, sdk, dir, events } = await setup(manual);
    const { nativeId } = await harness.createThread({ message: "start", cwd: dir });
    const query = await queryOf(sdk);
    await query.nextInput();
    await harness.interrupt(nativeId);
    await vi.waitFor(() => expect(query.interrupts).toBe(1));
    // The CLI ignored it and the turn starts anyway: the first output re-sends the stop.
    query.emit(delta(query, "Sure, "));
    await vi.waitFor(() => expect(query.interrupts).toBe(2));
    query.emit(result(query, { totalCost: 0, isError: true, errors: ["aborted"] }));
    await waitTurnEnds(events, 1);
    const snapshot = await harness.getThread(nativeId);
    expect(kinds(snapshot.items)).toEqual(["user:start", "notice:Stopped.", "turn"]);
  });

  it("relays a tool approval and honours allow and deny", async () => {
    const { harness, sdk, dir, events } = await setup(manual);
    const { nativeId } = await harness.createThread({ message: "clean up", cwd: dir });
    const query = await queryOf(sdk);
    await query.nextInput();
    expect(query.options.permissionMode).toBe("acceptEdits");

    query.emit(toolUse(query, "toolu_rm", "Bash", { command: "rm -rf build" }));
    const signal = new AbortController().signal;
    const first = query.options.canUseTool(
      "Bash",
      { command: "rm -rf build" },
      {
        signal,
        toolUseID: "toolu_rm",
        decisionReason: "Bash commands need approval",
        suggestions: [
          {
            type: "addRules",
            rules: [{ toolName: "Bash", ruleContent: "rm -rf build" }],
            behavior: "allow",
            destination: "session",
          },
        ],
      },
    );
    const ask = await attention(events);
    expect(ask).toMatchObject({ nativeId, text: "Claude Code wants to use Bash: rm -rf build" });
    const open = await harness.getThread(nativeId);
    expect(open.items.map((item) => item.id)).toEqual([
      expect.stringMatching(/:0$/),
      "toolu_rm",
      ask.key,
    ]);
    expect(open.items[2]).toMatchObject({
      kind: "request",
      status: "open",
      request: { kind: "tool", tool: "bash", reason: "Bash commands need approval" },
    });
    await harness.respond!(nativeId, ask.key, { decision: "allow" });
    await expect(first).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "rm -rf build" },
    });
    query.emit(toolResult(query, "toolu_rm", ""));

    query.emit(toolUse(query, "toolu_push", "Bash", { command: "git push --force" }));
    const second = query.options.canUseTool(
      "Bash",
      { command: "git push --force" },
      { signal, toolUseID: "toolu_push" },
    );
    const ask2 = await attention(events, 1);
    await harness.respond!(nativeId, ask2.key, { decision: "deny", message: "not on main" });
    await expect(second).resolves.toEqual({ behavior: "deny", message: "not on main" });
    query.emit(toolResult(query, "toolu_push", "not on main", { isError: true }));
    query.emit(result(query, { totalCost: 0.01 }));
    await waitTurnEnds(events, 1);
    const snapshot = await harness.getThread(nativeId);
    const byId = new Map(snapshot.items.map((item) => [item.id, item]));
    expect(byId.get(ask.key)).toMatchObject({ status: "allowed" });
    expect(byId.get(ask2.key)).toMatchObject({ status: "denied" });
    expect(byId.get("toolu_rm")).toMatchObject({ status: "done" });
    expect(byId.get("toolu_push")).toMatchObject({ status: "denied" });
    // An answer to a closed request is a no-op, not an error.
    await expect(
      harness.respond!(nativeId, ask.key, { decision: "deny" }),
    ).resolves.toBeUndefined();
  });

  it("answers AskUserQuestion with the user's answers", async () => {
    const { harness, sdk, dir, events } = await setup(manual);
    const { nativeId } = await harness.createThread({ message: "set up storage", cwd: dir });
    const query = await queryOf(sdk);
    await query.nextInput();
    const input = {
      questions: [
        {
          question: "Which database should we use?",
          header: "Database",
          multiSelect: false,
          options: [
            { label: "SQLite", description: "A local file" },
            { label: "Postgres", description: "A server" },
          ],
        },
      ],
    };
    query.emit(toolUse(query, "toolu_ask", "AskUserQuestion", input));
    const answer = query.options.canUseTool("AskUserQuestion", input, {
      signal: new AbortController().signal,
      toolUseID: "toolu_ask",
    });
    const ask = await attention(events);
    expect(ask.text).toBe("Claude Code asks: Which database should we use?");
    const open = await harness.getThread(nativeId);
    expect(open.items.find((item) => item.id === ask.key)).toMatchObject({
      kind: "request",
      request: {
        kind: "question",
        questions: [{ header: "Database", options: [{ label: "SQLite" }, { label: "Postgres" }] }],
      },
    });
    await expect(harness.respond!(nativeId, ask.key, { decision: "allow" })).rejects.toThrow(
      /answers/,
    );
    await harness.respond!(nativeId, ask.key, { answers: { Database: "SQLite" } });
    await expect(answer).resolves.toEqual({
      behavior: "allow",
      updatedInput: { ...input, answers: { "Which database should we use?": "SQLite" } },
    });
    await vi.waitFor(async () =>
      expect(
        (await harness.getThread(nativeId)).items.find((item) => item.id === ask.key),
      ).toMatchObject({ status: "answered" }),
    );
  });

  it("stops on a usage limit, shows when it resets, and keeps the queue", async () => {
    const { harness, sdk, dir, events } = await setup(manual);
    const { nativeId } = await harness.createThread({ message: "big job", cwd: dir });
    const query = await queryOf(sdk);
    await query.nextInput();
    await harness.send(nativeId, { message: "after that", queue: true });
    const interrupted = query.waitInterrupt();
    query.emit({
      type: "rate_limit_event",
      uuid: randomUUID(),
      session_id: query.sessionId,
      rate_limit_info: { status: "rejected", resetsAt: 1762365600, rateLimitType: "five_hour" },
    });
    await interrupted;
    query.emit(result(query, { totalCost: 0.01, isError: true, errors: ["Request was aborted."] }));
    const [ended] = await waitTurnEnds(events, 1);
    expect(ended?.outcome.failed).toBe(true);
    const snapshot = await harness.getThread(nativeId);
    expect(snapshot.items.find((item) => item.kind === "notice")).toMatchObject({
      level: "error",
      code: "usage_limit",
      resetsAt: new Date(1762365600 * 1000).toISOString(),
    });
    expect(snapshot.queued.map((item) => item.text)).toEqual(["after that"]);
    expect(query.received).toHaveLength(1);
    expect((await harness.outcome(nativeId)).failed).toBe(true);
  });

  it("reads the same transcript back after an app restart, and resumes after a worker restart", async () => {
    const setupResult = await setup(echo);
    const { harness, sdk, dir, events, host } = setupResult;
    const { nativeId } = await harness.createThread({ message: "remember me", cwd: dir });
    await waitTurnEnds(events, 1);
    const before = await harness.getThread(nativeId);

    // A second app process: same thread index, fresh driver.
    const again = createClaudeCodeHarness({
      host,
      resolveWorker: async () => ({ url: setupResult.server.url, token: TOKEN }),
      timings: { reconnectMinMs: 10, reconnectMaxMs: 40, requestTimeoutMs: 5_000 },
    });
    again.start();
    cleanups.push(() => again.stop());
    const after = await again.getThread(nativeId);
    expect(after.items).toEqual(before.items);
    // One app process owns the index: the old one is gone.
    again.stop();

    // The worker restarts: a watcher starts over from the transcript on disk,
    // and the next turn resumes the stored Claude session.
    const watch = collect();
    cleanups.push(harness.watchThread(nativeId, watch.listener));
    await watch.next((event) => event.type === "snapshot");
    const claudeSessionId = sdk.queries[0]!.sessionId;
    await setupResult.server.close();
    setupResult.server = await startServer(sdk, dir);
    await vi.waitFor(() =>
      expect(events.filter((event) => event.type === "connected").length).toBeGreaterThanOrEqual(2),
    );
    const restarted = await watch.next((event) => event.type === "snapshot", 4000);
    if (restarted.type !== "snapshot") throw new Error("no snapshot");
    expect(restarted.snapshot.items).toEqual(before.items);
    expect(threadEventProblems(watch.events)).toEqual([]);
    await harness.send(nativeId, { message: "still there?" });
    await waitTurnEnds(events, 2);
    expect(sdk.queries[1]?.options.resume).toBe(claudeSessionId);
    const snapshot = await harness.getThread(nativeId);
    expect(kinds(snapshot.items)).toEqual([
      "user:remember me",
      "assistant:Echo: remember me",
      "turn",
      "user:still there?",
      "assistant:Echo: still there?",
      "turn",
    ]);
  });

  it("changes model, effort and permission mode live; bypass restarts the process", async () => {
    const { harness, sdk, dir, events } = await setup(echo);
    const { nativeId } = await harness.createThread({ message: "hi", cwd: dir, effort: "low" });
    await waitTurnEnds(events, 1);
    const query = sdk.queries[0]!;
    expect(query.options.effort).toBe("low");
    await expect(
      harness.updateSettings!(nativeId, {
        model: "sonnet",
        effort: "high",
        permissionMode: "plan",
      }),
    ).resolves.toEqual({ model: "sonnet", effort: "high", permissionMode: "plan" });
    expect(query.calls).toEqual(
      expect.arrayContaining([
        { method: "setModel", args: ["sonnet"] },
        { method: "applyFlagSettings", args: [{ effortLevel: "high" }] },
        { method: "setPermissionMode", args: ["plan"] },
      ]),
    );
    await harness.updateSettings!(nativeId, { permissionMode: "bypassPermissions" });
    await query.whenClosed();
    await harness.send(nativeId, { message: "go" });
    await waitTurnEnds(events, 2);
    const next = sdk.queries[1]!;
    expect(next.options).toMatchObject({
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      model: "sonnet",
      effort: "high",
      resume: query.sessionId,
    });
    await expect(harness.updateSettings!(nativeId, { effort: "extreme" })).rejects.toThrow(
      /Unknown effort/,
    );
  });

  it("renames, archives and forks threads in the index", async () => {
    const { harness, sdk, dir, events } = await setup(echo);
    const { nativeId } = await harness.createThread({ message: "base", cwd: dir });
    await waitTurnEnds(events, 1);
    await harness.rename!(nativeId, "Renamed");
    const snapshot = await harness.getThread(nativeId);
    expect(snapshot.thread.title).toBe("Renamed");
    const forkAt = snapshot.items.find((item) => item.kind === "user");
    if (forkAt?.kind !== "user" || !forkAt.forkAt) throw new Error("no fork point");
    const fork = await harness.fork!(nativeId, forkAt.forkAt);
    const forked = await harness.getThread(fork.nativeId);
    expect(forked.thread).toMatchObject({
      title: "Renamed (fork)",
      parentId: `claude-code:${nativeId}`,
    });
    expect(kinds(forked.items)).toEqual(["user:base"]);
    expect(sdk.transcripts.size).toBe(2);

    await harness.archive!(nativeId, true);
    expect((await harness.listThreads("archived")).map((thread) => thread.nativeId)).toEqual([
      nativeId,
    ]);
    expect((await harness.listThreads("active")).map((thread) => thread.nativeId)).toEqual([
      fork.nativeId,
    ]);
    await vi.waitFor(() => expect(sdk.queries[0]!.closed).toBe(true));
  });

  it("keeps coding turns in their own budget", async () => {
    const { harness, sdk, dir } = await setup(manual, {
      limits: { maxRunningTurns: 1, maxLiveProcesses: 2 },
    });
    await harness.createThread({ message: "a", cwd: dir });
    const first = await queryOf(sdk, 0);
    await first.nextInput();
    await expect(harness.createThread({ message: "b", cwd: dir })).rejects.toThrow(
      /turns are already running/,
    );
    // The refused thread is not left behind.
    expect(await harness.listThreads("active")).toHaveLength(1);
  });

  it("evicts an idle process to make room, and refuses when all are busy", async () => {
    const { harness, sdk, dir, events } = await setup(echo, {
      limits: { maxRunningTurns: 2, maxLiveProcesses: 1 },
    });
    await harness.createThread({ message: "a", cwd: dir });
    await waitTurnEnds(events, 1);
    await harness.createThread({ message: "b", cwd: dir });
    await waitTurnEnds(events, 2);
    expect(sdk.queries[0]!.closed).toBe(true);
    expect(sdk.queries).toHaveLength(2);
  });

  it("refuses a cwd that does not exist and needs one", async () => {
    const { harness } = await setup(manual);
    await expect(harness.createThread({ message: "x" })).rejects.toThrow(/working directory/);
    await expect(
      harness.createThread({ message: "x", cwd: "/definitely/not/here" }),
    ).rejects.toThrow(/does not exist/);
  });

  // Register row C13 (fixed in 4.6): bad input is a 400 and an unknown thread
  // a 404, typed at the driver and kept by the Code routes; anything the
  // driver did not expect stays a 500.
  it("answers bad input with 400 and an unknown thread with 404, through the Code routes", async () => {
    const { harness, dir, events } = await setup(echo);
    await expect(harness.createThread({ message: "x" })).rejects.toMatchObject({
      status: 400,
      message: "Claude Code needs a working directory.",
    });
    await expect(harness.getThread("nope")).rejects.toBeInstanceOf(HarnessError);

    setCodeHub(createCodeHub({ instances: [harness] }))!.start();
    cleanups.push(() => void setCodeHub(undefined));
    const app = createTestApp();
    const token = await authToken("claude-code-errors@example.com");
    const call = (path: string, json?: unknown) =>
      api<unknown>(app, `/api/v1/code${path}`, {
        method: json === undefined ? "GET" : "POST",
        token,
        ...(json === undefined ? {} : { json }),
      });
    const message = (response: { body: unknown }) =>
      (response.body as { error?: { message?: string } }).error?.message;

    const missingCwd = await call("/threads", {
      instanceId: "claude-code",
      message: "x",
      cwd: path.join(dir, "not-here"),
    });
    expect(missingCwd.status).toBe(400);
    expect(message(missingCwd)).toMatch(/does not exist/);

    const badEffort = await call("/threads", {
      instanceId: "claude-code",
      message: "x",
      cwd: dir,
      effort: "extreme",
    });
    expect(badEffort.status).toBe(400);
    expect(message(badEffort)).toBe(
      'Unknown effort "extreme". Use one of: low, medium, high, xhigh, max.',
    );

    const unknown = await call(`/threads/${encodeURIComponent("claude-code:nope")}`);
    expect(unknown.status).toBe(404);
    expect(message(unknown)).toBe("No Claude Code thread nope.");

    const created = await call("/threads", { instanceId: "claude-code", message: "hi", cwd: dir });
    expect(created.status).toBe(201);
    const { threadId } = (created.body as { data: { threadId: string } }).data;
    await waitTurnEnds(events, 1);
    const badSetting = await call(`/threads/${encodeURIComponent(threadId)}/settings`, {
      effort: "extreme",
    });
    expect(badSetting.status).toBe(400);
    expect(message(badSetting)).toMatch(/^Unknown effort "extreme"/);

    // The worker unreachable is not the caller's fault: still a 500.
    harness.stop();
    const unreachable = await call("/threads", {
      instanceId: "claude-code",
      message: "x",
      cwd: dir,
    });
    expect(unreachable.status).toBe(500);
  });

  it("serves the workspace: diffs, files, browsing, uploads and assets", async () => {
    const { harness, dir } = await setup(manual);
    const repo = path.join(dir, "repo");
    await mkdir(path.join(repo, "src"), { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "T",
          GIT_AUTHOR_EMAIL: "t@example.com",
          GIT_COMMITTER_NAME: "T",
          GIT_COMMITTER_EMAIL: "t@example.com",
        },
      });
    git("init", "-q");
    await writeFile(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    await writeFile(path.join(repo, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    git("add", ".");
    git("commit", "-q", "-m", "first commit");
    await writeFile(path.join(repo, "src", "a.ts"), "export const a = 2;\nexport const b = 3;\n");
    await writeFile(path.join(repo, "notes.md"), "hello world\n");

    const { diffs, gitRoot } = await harness.diffs!(repo);
    expect(gitRoot).toBe(repo);
    expect(diffs[0]).toMatchObject({ id: "working", filesCount: 2, additions: 3, deletions: 1 });
    expect(diffs[1]).toMatchObject({ message: "first commit", author: "T", filesCount: 2 });
    const working = await harness.diffFiles!(repo, "working");
    expect(working).toEqual(
      expect.arrayContaining([
        { path: "src/a.ts", status: "modified", additions: 2, deletions: 1, isGenerated: false },
        { path: "notes.md", status: "added", additions: 1, deletions: 0, isGenerated: false },
      ]),
    );
    const committed = await harness.diffFiles!(repo, diffs[1]!.id);
    expect(committed.find((file) => file.path === "pnpm-lock.yaml")).toMatchObject({
      status: "added",
      isGenerated: true,
    });
    await expect(harness.fileDiff!(repo, "working", "src/a.ts")).resolves.toEqual({
      path: "src/a.ts",
      oldContent: "export const a = 1;\n",
      newContent: "export const a = 2;\nexport const b = 3;\n",
    });
    await expect(harness.fileDiff!(repo, diffs[1]!.id, "src/a.ts")).resolves.toMatchObject({
      oldContent: "",
      newContent: "export const a = 1;\n",
    });
    await expect(harness.fileDiff!(repo, "working", "../../etc/passwd")).rejects.toThrow(
      /inside the repository/,
    );
    await expect(harness.fileDiff!(repo, "HEAD; rm -rf /", "src/a.ts")).rejects.toThrow();

    expect((await harness.findFiles!(repo, "a.ts")).map((match) => match.path)).toEqual([
      "src/a.ts",
    ]);
    expect(await harness.findFiles!(repo, "hello", "only")).toEqual([
      { path: "notes.md", line: 1, text: "hello world" },
    ]);

    const listing = await harness.browse!(repo);
    expect(listing).toMatchObject({
      path: repo,
      parent: dir,
      repoRoot: repo,
      headSubject: "first commit",
    });
    expect(listing.entries).toEqual([
      { name: "src", isDir: true },
      { name: "notes.md", isDir: false },
      { name: "pnpm-lock.yaml", isDir: false },
    ]);
    expect((await harness.browse!()).path).toBe(dir);
    await expect(harness.validateCwd!(repo)).resolves.toEqual({ valid: true });
    await expect(harness.validateCwd!("relative/path")).resolves.toMatchObject({ valid: false });

    const { ref } = await harness.upload!(new Blob(["screenshot bytes"]), "../shot one.png");
    expect(ref.startsWith(path.join(dir, ".uploads") + path.sep)).toBe(true);
    expect(path.basename(ref)).toBe("shot one.png");
    const response = await harness.asset!(ref);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("screenshot bytes");
    await expect(harness.asset!(path.join(repo, "notes.md"))).rejects.toThrow(/No such asset/);
    await expect(harness.asset!(`${path.join(dir, ".uploads")}/../repo/notes.md`)).rejects.toThrow(
      /No such asset/,
    );
  });

  it("sends uploaded files as paths Claude Code can read", async () => {
    const { harness, sdk, dir } = await setup(manual);
    const { ref } = await harness.upload!(new Blob(["x"]), "diagram.png");
    const { nativeId } = await harness.createThread({
      message: "what is this?",
      cwd: dir,
      attachments: [ref],
    });
    const query = await queryOf(sdk);
    const prompt = await query.nextInput();
    expect(prompt?.message.content).toContain(`- ${ref}`);
    const snapshot = await harness.getThread(nativeId);
    expect(snapshot.items[0]).toMatchObject({
      kind: "user",
      text: "what is this?",
      attachments: [{ ref, name: "diagram.png", image: true }],
    });
  });
});

describeTurnOutcomeRule("Claude Code", async (turn: TurnCase) => {
  const { harness, sdk, dir, events } = await setup(manual);
  const first = turn === "steered" ? "task" : turn === "unanswered" ? "one" : "go";
  const { nativeId } = await harness.createThread({ message: first, cwd: dir });
  const query = await queryOf(sdk);
  await query.nextInput();
  const stop = async () => {
    const interrupted = query.waitInterrupt();
    await harness.interrupt(nativeId);
    await interrupted;
    query.emit(result(query, { totalCost: 0.01, isError: true, errors: ["Request was aborted."] }));
  };
  switch (turn) {
    case "answered":
      query.emit(text(query, "Done: 3 files."));
      query.emit(result(query, { totalCost: 0.01, text: "Done: 3 files." }));
      break;
    case "failed":
      query.emit(result(query, { totalCost: 0.01, isError: true, errors: ["boom"] }));
      break;
    case "steered":
      query.emit(text(query, "Halfway."));
      await harness.send(nativeId, { message: "also docs" });
      await query.nextInput();
      await stop();
      break;
    case "unanswered":
      query.emit(text(query, "First done."));
      query.emit(result(query, { totalCost: 0.01, text: "First done." }));
      await waitTurnEnds(events, 1);
      await harness.send(nativeId, { message: "two" });
      await query.nextInput();
      await stop();
      await waitTurnEnds(events, 2);
      break;
  }
  await waitTurnEnds(events, 1);
  return { harness, nativeId, events };
});
