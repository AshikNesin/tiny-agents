import type { Context as PiContext, JsonObject } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { agentRuntimePort } from "../../../../apps/web/src/server/api/code/code.registry";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
  TEST_MODEL_2,
  type TestRuntimeOptions,
} from "../../../../packages/agent/src/testing";
import { createCodingToolkit } from "../../../../packages/agent/src/toolkits/coding";
import type {
  HarnessHost,
  HarnessInstance,
  InstanceEvent,
  TranscriptItem,
} from "../../../../packages/code/src/contracts";
import { createPiHarness, HarnessError } from "../../../../packages/code/src/server/index";
import {
  capabilityProblems,
  collect,
  testHost,
  threadEventProblems,
  turnOutcomeProblems,
} from "../../../../packages/code/src/testing";
import { FIXED_NOW } from "../../../test-clock";
import {
  fakeSandboxConnection,
  type FakeSandboxConnection,
} from "../../app/agent/sandbox-connection-fake";
import { until } from "../../fixtures/until";
import { describeTurnOutcomeRule, type TurnCase } from "../turn-outcome-conformance";

type Brain = NonNullable<TestRuntimeOptions["respondWith"]>;
type Request = Parameters<Brain>[1];

const CWD = "/work";
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

function stoppedOr(request: Request, opened: Promise<void>): Promise<void> {
  return Promise.race([
    opened,
    new Promise<void>((resolve) => request?.signal?.addEventListener("abort", () => resolve())),
  ]);
}

function textOf(message: PiContext["messages"][number]): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

function lastUser(context: PiContext): string {
  const user = context.messages.findLast((message) => message.role === "user");
  return user ? textOf(user) : "";
}

const echo: Brain = (context) => fauxAssistantMessage(fauxText(`Echo: ${lastUser(context)}`));

function callTool(name: string, args: JsonObject, say?: string) {
  return {
    ...fauxAssistantMessage([...(say ? [fauxText(say)] : []), fauxToolCall(name, args)]),
    stopReason: "toolUse" as const,
  };
}

function toolThenEcho(name: string, args: JsonObject): Brain {
  return (context) => {
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") return fauxAssistantMessage(fauxText(`Tool: ${textOf(last)}`));
    if (last?.role === "user" && context.messages.some((m) => m.role === "toolResult")) {
      return echo(context);
    }
    return callTool(name, args);
  };
}

interface Setup {
  runtime: AgentRuntime;
  harness: HarnessInstance;
  host: HarnessHost;
  events: InstanceEvent[];
  connection: FakeSandboxConnection;
}

async function setup(
  brain: Brain,
  options: {
    exec?: NonNullable<Parameters<typeof fakeSandboxConnection>[0]>["exec"];
    tokensPerSecond?: number;
    settings?: TestRuntimeOptions["settings"];
  } = {},
): Promise<Setup> {
  const connection = fakeSandboxConnection({
    exec: options.exec ?? ((command) => ({ stdout: `ran ${command}` })),
  });
  const runtime = await openTestRuntime({
    storePath: ":memory:",
    capabilities: [createCodingToolkit({ connection })],
    respondWith: brain,
    ...(options.tokensPerSecond ? { tokensPerSecond: options.tokensPerSecond } : {}),
    ...(options.settings ? { settings: options.settings } : {}),
  });
  const host = testHost();
  const harness = createPiHarness({ host, port: agentRuntimePort(() => runtime) });
  const events: InstanceEvent[] = [];
  harness.subscribe((event) => events.push(event));
  harness.start();
  cleanups.push(async () => {
    harness.stop();
    await runtime.close();
  });
  return { runtime, harness, host, events, connection };
}

function turnEnds(events: InstanceEvent[]) {
  return events.filter(
    (event): event is Extract<InstanceEvent, { type: "turn_ended" }> => event.type === "turn_ended",
  );
}

function waitTurnEnds(events: InstanceEvent[], count: number) {
  return until(
    () => (turnEnds(events).length >= count ? turnEnds(events) : undefined),
    `${count} turn end(s)`,
  );
}

function attention(events: InstanceEvent[], index = 0) {
  return until(
    () =>
      events.filter(
        (event): event is Extract<InstanceEvent, { type: "attention" }> =>
          event.type === "attention",
      )[index],
    "the harness to ask for the owner",
  );
}

function kinds(items: TranscriptItem[]): string[] {
  return items.map((item) =>
    item.kind === "notice"
      ? `notice:${item.text}`
      : item.kind === "user" || item.kind === "assistant"
        ? `${item.kind}:${item.text}`
        : item.kind === "tool"
          ? `tool:${item.name}:${item.status}`
          : item.kind === "request"
            ? `request:${item.status}`
            : item.kind,
  );
}

function hangUntilStopped(_command: string, options: { signal?: AbortSignal }) {
  return new Promise<never>((_resolve, reject) => {
    options.signal?.addEventListener("abort", () =>
      reject(new Error("Stopped before the command finished.")),
    );
  });
}

describe("Native harness", () => {
  it("is honest about its capabilities", async () => {
    const { harness } = await setup(echo);

    expect(capabilityProblems(harness)).toEqual([]);
    expect({ id: harness.id, kind: harness.kind, label: harness.label }).toEqual({
      id: "pi",
      kind: "pi",
      label: "Native",
    });
    const caps = harness.capabilities();
    expect(caps.turns).toEqual({
      interrupt: true,
      steer: true,
      queue: true,
      manageQueue: true,
      recovery: ["continue"],
      compact: true,
    });
    expect(caps.threads).toMatchObject({ fork: true, archive: true, rename: true, delete: false });
    expect(caps.settings.permissionModes).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "bypassPermissions",
    ]);
    expect(caps.settings.defaultPermissionMode).toBe("bypassPermissions");
    expect(caps.approvals).toEqual({ tools: true, questions: true });
    expect(caps.workspace.requiresCwd).toBe(true);
    expect(harness.remove).toBeUndefined();
    expect(harness.status().state).toBe("connected");
  });

  it("lists the models that run on pi, the default first", async () => {
    const { harness } = await setup(echo);

    const models = await harness.models();

    expect(models.map((model) => [model.id, model.isDefault ?? false])).toEqual([
      [TEST_MODEL, true],
      [TEST_MODEL_2, false],
    ]);
  });

  it("runs a simple turn in the thread's cwd and keeps the thread in the index", async () => {
    const { harness, host, events } = await setup(echo);

    const { nativeId } = await harness.createThread({ message: "  hello there\nmore", cwd: CWD });

    const [ended] = await waitTurnEnds(events, 1);
    expect(ended).toMatchObject({
      nativeId,
      outcome: { working: false, failed: false, text: "Echo:   hello there\nmore", cursor: 1 },
    });
    const snapshot = await harness.getThread(nativeId);
    expect(snapshot.thread).toMatchObject({
      id: `pi:${nativeId}`,
      kind: "pi",
      title: "hello there",
      cwd: CWD,
      model: null,
      working: false,
      permissionMode: "bypassPermissions",
      cursor: 1,
    });
    expect(kinds(snapshot.items)).toEqual([
      "user:  hello there\nmore",
      "assistant:Echo:   hello there\nmore",
      "turn",
    ]);
    expect(snapshot.settings).toEqual({
      model: null,
      effort: null,
      permissionMode: "bypassPermissions",
    });
    expect(turnOutcomeProblems(snapshot, await harness.outcome(nativeId), ended!.outcome)).toEqual(
      [],
    );
    expect((await harness.listThreads("active")).map((thread) => thread.nativeId)).toEqual([
      nativeId,
    ]);
    expect(await host.index.get("pi", nativeId)).toMatchObject({ cwd: CWD, title: "hello there" });
  });

  it("needs an absolute working directory and a model it can run, and knows its own threads only", async () => {
    const { harness, runtime } = await setup(echo);
    const foreign = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });

    await expect(harness.createThread({ message: "hi" })).rejects.toMatchObject({ status: 400 });
    await expect(harness.createThread({ message: "hi", cwd: "work" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      harness.createThread({ message: "hi", cwd: CWD, model: "no-such-model" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(harness.getThread(String(foreign))).rejects.toMatchObject({ status: 404 });
    await expect(harness.send("999", { message: "hi" })).rejects.toBeInstanceOf(HarnessError);
    expect(await harness.listThreads("active")).toEqual([]);
  });

  it("streams a watched turn: the snapshot, partial text, rows, then idle", async () => {
    const start = gate();
    const { harness, events } = await setup(
      async (context, request) => {
        await stoppedOr(request, start.opened);
        return fauxAssistantMessage([
          fauxThinking("Let me think."),
          fauxText(`A long enough answer to ${lastUser(context)} that it streams in pieces.`),
        ]);
      },
      { tokensPerSecond: 40 },
    );
    const { nativeId } = await harness.createThread({ message: "explain", cwd: CWD });
    const watch = collect();
    cleanups.push(harness.watchThread(nativeId, watch.listener));

    const first = await watch.next((event) => event.type === "snapshot");
    if (first.type !== "snapshot") throw new Error("no snapshot");
    expect(kinds(first.snapshot.items)).toEqual(["user:explain"]);
    expect(first.snapshot.thread.working).toBe(true);
    start.open();
    const partial = await watch.next((event) => event.type === "partial" && event.text !== "");
    await watch.next((event) => event.type === "state" && !event.working, 10_000);
    await waitTurnEnds(events, 1);

    expect(partial).toMatchObject({ type: "partial" });
    const rows = watch.events.flatMap((event) => (event.type === "items" ? event.items : []));
    expect(kinds(rows)).toEqual([
      "thinking",
      "assistant:A long enough answer to explain that it streams in pieces.",
      "turn",
    ]);
    expect(threadEventProblems(watch.events)).toEqual([]);
  });

  it("runs several turns in one thread", async () => {
    const { harness, events } = await setup(echo);
    const { nativeId } = await harness.createThread({ message: "one", cwd: CWD });
    await waitTurnEnds(events, 1);

    expect(await harness.send(nativeId, { message: "two" })).toEqual({ status: "accepted" });
    const ends = await waitTurnEnds(events, 2);

    const snapshot = await harness.getThread(nativeId);
    expect(kinds(snapshot.items)).toEqual([
      "user:one",
      "assistant:Echo: one",
      "turn",
      "user:two",
      "assistant:Echo: two",
      "turn",
    ]);
    expect(snapshot.thread.cursor).toBe(2);
    expect(ends[1]!.outcome).toMatchObject({ text: "Echo: two", cursor: 2 });
    expect((await harness.listThreads("active"))[0]).toMatchObject({ cursor: 2, working: false });
  });

  it("holds a queued message until the turn ends, and can cancel one", async () => {
    const first = gate();
    const { harness, events } = await setup(async (context, request) => {
      if (lastUser(context) === "one") await stoppedOr(request, first.opened);
      return echo(context);
    });
    const { nativeId } = await harness.createThread({ message: "one", cwd: CWD });

    expect(await harness.send(nativeId, { message: "two", queue: true })).toEqual({
      status: "queued",
    });
    await harness.send(nativeId, { message: "never mind", queue: true });
    const waiting = await until(async () => {
      const snapshot = await harness.getThread(nativeId);
      return snapshot.queued.length === 2 ? snapshot : undefined;
    }, "both queued messages");
    expect(waiting.queued).toEqual([
      { id: expect.any(String), text: "two", createdAt: FIXED_NOW },
      { id: expect.any(String), text: "never mind", createdAt: FIXED_NOW },
    ]);
    expect(waiting.thread).toMatchObject({ working: true, queuedCount: 2 });
    expect(kinds(waiting.items)).toEqual(["user:one"]);
    await harness.queued!(nativeId, "cancel", waiting.queued[1]!.id);
    first.open();

    await until(
      async () => (await harness.outcome(nativeId)).text === "Echo: two",
      "the queued turn's answer",
    );
    await waitTurnEnds(events, 1);
    const snapshot = await harness.getThread(nativeId);
    expect(kinds(snapshot.items)).toEqual([
      "user:one",
      "assistant:Echo: one",
      "turn",
      "user:two",
      "assistant:Echo: two",
      "turn",
    ]);
    expect(snapshot.queued).toEqual([]);
    await expect(harness.queued!(nativeId, "cancel", "gone")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("steers a running turn: the message joins it after the tool round", async () => {
    const command = gate();
    const { harness, events } = await setup(toolThenEcho("bash", { command: "pnpm test" }), {
      exec: async () => {
        await command.opened;
        return { stdout: "12 passed" };
      },
    });
    const { nativeId } = await harness.createThread({ message: "run the tests", cwd: CWD });
    await until(
      async () => kinds((await harness.getThread(nativeId)).items).includes("tool:bash:running"),
      "the command to start",
    );

    expect(await harness.send(nativeId, { message: "also the docs" })).toEqual({
      status: "accepted",
    });
    await harness.send(nativeId, { message: "and the changelog", queue: true });
    const waiting = await until(async () => {
      const snapshot = await harness.getThread(nativeId);
      return snapshot.queued.length === 2 ? snapshot : undefined;
    }, "the steer and the held message");
    await harness.queued!(nativeId, "send", waiting.queued[1]!.id);
    command.open();

    await waitTurnEnds(events, 1);
    const snapshot = await harness.getThread(nativeId);
    expect(kinds(snapshot.items)).toEqual([
      "user:run the tests",
      "tool:bash:done",
      "user:also the docs",
      "assistant:Echo: also the docs",
      "turn",
      "user:and the changelog",
      "assistant:Echo: and the changelog",
      "turn",
    ]);
    expect(snapshot.items[1]).toMatchObject({
      tool: "bash",
      summary: "pnpm test",
      output: "12 passed",
      exitCode: 0,
    });
    expect(turnEnds(events)).toHaveLength(1);
  });

  it("interrupts a running command and a reply that has not started", async () => {
    const { harness, events } = await setup(
      (context) =>
        lastUser(context) === "run the tests"
          ? callTool("bash", { command: "pnpm test" })
          : echo(context),
      { exec: hangUntilStopped },
    );
    const { nativeId } = await harness.createThread({ message: "run the tests", cwd: CWD });
    await until(
      async () => kinds((await harness.getThread(nativeId)).items).includes("tool:bash:running"),
      "the command to start",
    );

    await harness.interrupt(nativeId);

    const [ended] = await waitTurnEnds(events, 1);
    expect(ended!.outcome).toMatchObject({ working: false, failed: false, text: "" });
    const snapshot = await harness.getThread(nativeId);
    expect(kinds(snapshot.items)).toEqual([
      "user:run the tests",
      "tool:bash:error",
      "notice:Stopped.",
      "turn",
    ]);
    expect(snapshot.thread.working).toBe(false);
    await harness.send(nativeId, { message: "carry on" });
    await waitTurnEnds(events, 2);
    expect(kinds((await harness.getThread(nativeId)).items).slice(4)).toEqual([
      "user:carry on",
      "assistant:Echo: carry on",
      "turn",
    ]);
  });

  it("relays a tool approval, and honours allow and deny", async () => {
    let asked = 0;
    const { harness, events, connection } = await setup((context) => {
      const last = context.messages.at(-1);
      if (last?.role !== "toolResult") return callTool("bash", { command: "rm -rf build" });
      asked++;
      return asked === 1
        ? callTool("write", { path: "notes.md", content: "done\n" })
        : fauxAssistantMessage(fauxText("Cleaned up."));
    });
    const { nativeId } = await harness.createThread({
      message: "clean up",
      cwd: CWD,
      permissionMode: "default",
    });

    const ask = await attention(events);
    expect(ask).toMatchObject({
      nativeId,
      text: "Native wants to use bash: rm -rf build",
    });
    const waiting = await harness.getThread(nativeId);
    expect(kinds(waiting.items)).toEqual(["user:clean up", "tool:bash:running", "request:open"]);
    expect(waiting.items[2]).toMatchObject({
      id: ask.key,
      request: { kind: "tool", tool: "bash", name: "bash", summary: "rm -rf build" },
    });
    expect(connection.execs).toEqual([]);
    await harness.respond!(nativeId, ask.key, { decision: "allow" });

    const second = await attention(events, 1);
    expect(connection.execs.map((exec) => exec.command)).toEqual([
      "cd '/work' && eval 'rm -rf build'",
    ]);
    await harness.respond!(nativeId, second.key, { decision: "deny" });
    await waitTurnEnds(events, 1);

    const snapshot = await harness.getThread(nativeId);
    expect(kinds(snapshot.items)).toEqual([
      "user:clean up",
      "tool:bash:done",
      "request:allowed",
      "tool:write:denied",
      "request:denied",
      "assistant:Cleaned up.",
      "turn",
    ]);
    expect(connection.writes).toEqual([]);
    await expect(harness.respond!(nativeId, ask.key, { decision: "allow" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("shows an edit's diff on its row", async () => {
    const { harness, events, connection } = await setup(
      toolThenEcho("edit", { path: "a.txt", old_text: "one", new_text: "two" }),
    );
    await connection.writeFile("/work/a.txt", "one\n");

    const { nativeId } = await harness.createThread({ message: "fix it", cwd: CWD });
    await waitTurnEnds(events, 1);

    const tool = (await harness.getThread(nativeId)).items[1];
    expect(tool).toMatchObject({
      kind: "tool",
      tool: "edit",
      summary: "a.txt",
      status: "done",
      diff: { path: "a.txt", diff: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+two\n" },
    });
  });

  it("asks the owner a question and takes the answer", async () => {
    const { harness, events } = await setup((context) => {
      const last = context.messages.at(-1);
      if (last?.role === "toolResult") return fauxAssistantMessage(fauxText(textOf(last)));
      return callTool("ask_owner", {
        questions: [
          { question: "Which stack?", options: [{ label: "React" }, { label: "Svelte" }] },
        ],
      });
    });
    const { nativeId } = await harness.createThread({ message: "start a project", cwd: CWD });

    const ask = await attention(events);
    expect(ask.text).toBe("Native asks: Which stack?");
    const waiting = await harness.getThread(nativeId);
    expect(waiting.items[1]).toMatchObject({
      kind: "request",
      id: ask.key,
      status: "open",
      request: {
        kind: "question",
        questions: [
          { question: "Which stack?", options: [{ label: "React" }, { label: "Svelte" }] },
        ],
      },
    });
    await harness.respond!(nativeId, ask.key, { answers: { "Which stack?": "Svelte" } });
    await waitTurnEnds(events, 1);

    const snapshot = await harness.getThread(nativeId);
    expect(kinds(snapshot.items).slice(0, 2)).toEqual(["user:start a project", "request:answered"]);
    expect((await harness.outcome(nativeId)).text).toContain("A: Svelte");
  });

  it("forks at a message, that message included, and continues the fork", async () => {
    const { harness, events } = await setup(echo);
    const { nativeId } = await harness.createThread({ message: "one", cwd: CWD });
    await waitTurnEnds(events, 1);
    await harness.send(nativeId, { message: "two" });
    await waitTurnEnds(events, 2);
    const second = (await harness.getThread(nativeId)).items[3];
    if (second?.kind !== "user" || !second.forkAt) throw new Error("no fork point");

    const fork = await harness.fork!(nativeId, second.forkAt);

    const forked = await harness.getThread(fork.nativeId);
    expect(forked.thread).toMatchObject({
      title: "one (fork)",
      parentId: `pi:${nativeId}`,
      cwd: CWD,
    });
    expect(kinds(forked.items)).toEqual([
      "user:one",
      "assistant:Echo: one",
      "turn",
      "user:two",
      "notice:No reply was produced for this message.",
      "turn",
    ]);
    await harness.recover!(fork.nativeId, "continue");
    const ends = await waitTurnEnds(events, 3);
    expect(ends[2]).toMatchObject({ nativeId: fork.nativeId, outcome: { text: "Echo: two" } });
    expect(kinds((await harness.getThread(nativeId)).items)).toHaveLength(6);
    await expect(harness.fork!(nativeId, "e999999")).rejects.toMatchObject({ status: 400 });
  });

  it("shows a model error as a notice that can be continued", async () => {
    let failing = true;
    const { harness, events } = await setup((context) =>
      failing
        ? fauxAssistantMessage(fauxText(""), { stopReason: "error", errorMessage: "overloaded" })
        : echo(context),
    );
    const { nativeId } = await harness.createThread({ message: "go", cwd: CWD });
    const [ended] = await waitTurnEnds(events, 1);
    expect(ended!.outcome).toMatchObject({ failed: true, text: "overloaded" });
    expect((await harness.getThread(nativeId)).items[1]).toMatchObject({
      kind: "notice",
      level: "error",
      text: "overloaded",
      retryable: true,
    });

    failing = false;
    await harness.recover!(nativeId, "continue");

    const ends = await waitTurnEnds(events, 2);
    expect(ends[1]!.outcome).toMatchObject({ failed: false, text: "Echo: go" });
  });

  it("changes the model and the permission mode of a thread", async () => {
    const offered: string[][] = [];
    const { harness, events } = await setup((context) => {
      const system = context.messages.findLast((message) => message.role === "system") as
        | { toolsAdded?: { name: string }[]; toolsRemoved?: string[] }
        | undefined;
      offered.push((system?.toolsAdded ?? []).map((tool) => tool.name));
      return echo(context);
    });
    const { nativeId } = await harness.createThread({
      message: "one",
      cwd: CWD,
      permissionMode: "plan",
    });
    await waitTurnEnds(events, 1);

    const settings = await harness.updateSettings!(nativeId, {
      model: TEST_MODEL_2,
      permissionMode: "acceptEdits",
    });
    await harness.send(nativeId, { message: "two" });
    await waitTurnEnds(events, 2);

    expect(settings).toEqual({ model: TEST_MODEL_2, effort: null, permissionMode: "acceptEdits" });
    expect(offered[0]).toEqual(["read", "find", "ask_owner"]);
    expect(offered[1]).toEqual(expect.arrayContaining(["write", "edit", "bash"]));
    expect((await harness.getThread(nativeId)).thread).toMatchObject({
      model: TEST_MODEL_2,
      permissionMode: "acceptEdits",
    });
    await expect(harness.updateSettings!(nativeId, { model: "nope" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(harness.updateSettings!(nativeId, { effort: "high" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("compacts on /compact without adding a message", async () => {
    const { harness, events } = await setup(
      (context) =>
        JSON.stringify(context.messages).includes("keep the names")
          ? fauxAssistantMessage(fauxText("Summary."))
          : echo(context),
      { settings: { compaction: { keepRecentTokens: 0 } } },
    );
    const { nativeId } = await harness.createThread({ message: "one", cwd: CWD });
    await waitTurnEnds(events, 1);
    await harness.send(nativeId, { message: "two" });
    await waitTurnEnds(events, 2);

    expect(await harness.send(nativeId, { message: "/compact keep the names" })).toEqual({
      status: "accepted",
    });

    const items = await until(async () => {
      const rows = kinds((await harness.getThread(nativeId)).items);
      return rows.includes("notice:Earlier messages summarized") ? rows : undefined;
    }, "the compaction notice");
    expect(items.filter((row) => row.startsWith("user:"))).toEqual(["user:one", "user:two"]);
  });

  it("renames and archives a thread, and a new driver reads the same transcript", async () => {
    const { harness, host, events, runtime } = await setup(echo);
    const { nativeId } = await harness.createThread({ message: "base", cwd: CWD });
    await waitTurnEnds(events, 1);

    await harness.rename!(nativeId, "  Renamed  ");
    await harness.archive!(nativeId, true);

    expect((await harness.listThreads("active")).map((thread) => thread.nativeId)).toEqual([]);
    expect((await harness.listThreads("archived"))[0]).toMatchObject({
      nativeId,
      title: "Renamed",
      archived: true,
    });
    const restarted = createPiHarness({ host, port: agentRuntimePort(() => runtime) });
    restarted.start();
    cleanups.push(() => restarted.stop());
    expect(kinds((await restarted.getThread(nativeId)).items)).toEqual([
      "user:base",
      "assistant:Echo: base",
      "turn",
    ]);
  });
});

describeTurnOutcomeRule("Native", async (turn: TurnCase) => {
  const command = gate();
  const { harness, events } = await setup(
    async (context, request) => {
      const said = lastUser(context);
      const last = context.messages.at(-1);
      if (turn === "answered") return fauxAssistantMessage(fauxText("Done: 3 files."));
      if (turn === "failed") {
        return fauxAssistantMessage(fauxText(""), { stopReason: "error", errorMessage: "boom" });
      }
      if (turn === "steered" && last?.role === "user" && said === "task") {
        return callTool("bash", { command: "sleep 1" }, "Halfway.");
      }
      if (said === "one") return fauxAssistantMessage(fauxText("First done."));
      await stoppedOr(request, new Promise(() => undefined));
      return fauxAssistantMessage(fauxText("never"));
    },
    {
      exec: async () => {
        await command.opened;
        return { stdout: "" };
      },
    },
  );
  const first = turn === "steered" ? "task" : turn === "unanswered" ? "one" : "go";
  const { nativeId } = await harness.createThread({ message: first, cwd: CWD });
  const requested = (text: string) =>
    until(
      async () =>
        (await harness.getThread(nativeId)).items.some(
          (item) => item.kind === "user" && item.text === text,
        ),
      `the model to be asked about "${text}"`,
    );
  if (turn === "steered") {
    await until(
      async () => kinds((await harness.getThread(nativeId)).items).includes("tool:bash:running"),
      "the command to start",
    );
    await harness.send(nativeId, { message: "also docs" });
    command.open();
    await requested("also docs");
    await harness.interrupt(nativeId);
  }
  if (turn === "unanswered") {
    await waitTurnEnds(events, 1);
    await harness.send(nativeId, { message: "two" });
    await requested("two");
    await harness.interrupt(nativeId);
    await waitTurnEnds(events, 2);
  }
  await waitTurnEnds(events, 1);
  return { harness, nativeId, events };
});
