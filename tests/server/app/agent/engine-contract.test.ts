import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { until } from "../../fixtures/until";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import { finishedReplyTo } from "../../../../packages/agent/src/replies";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import { TEST_MODEL } from "../../../../packages/agent/src/testing";
import type { ActivityChange, ChatToolCall } from "../../../../packages/agent/src/types";
import {
  awaitingApproval,
  engineModelConfig,
  ENGINES,
  mailCapability,
  openEngine,
  SILENT,
  watch,
  type EngineKind,
} from "./engine-harness";

const runtimes: AgentRuntime[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

async function storeFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "tiny-agents-engine-"));
  directories.push(directory);
  return join(directory, "agent.db");
}

async function setup(kind: EngineKind) {
  const engine = await openEngine(kind, { capabilities: [mailCapability([])] });
  runtimes.push(engine.runtime);
  const config = (systemPrompt = "Be brief.", modelId = engine.modelId) => ({
    modelId,
    systemPrompt,
    capabilities: { enabled: ["mail"], permissions: {} },
  });
  const ref = await engine.runtime.createConversation(config());
  const replied = (text: string, conversation = ref) =>
    until(async () => {
      const state = await engine.runtime.readChat(conversation);
      const last = state.messages.at(-1);
      return !state.busy && last?.role === "assistant" && last.text === `Echo: ${text}`
        ? state
        : undefined;
    }, `the reply to ${text}`);
  const reply = async (text: string, requestId: string) => {
    await engine.send(ref, { requestId, text });
    return replied(text);
  };
  return { ...engine, ref, config, reply, replied };
}

describe.each(ENGINES)("AgentEngine contract on %s", (kind) => {
  it("runs a turn: the reply, its user message and the idle state", async () => {
    const { runtime, ref, reply } = await setup(kind);
    const activity: ActivityChange[] = [];
    runtime.onActivity((change) => activity.push(change));

    const state = await reply("hello", "r1");
    const [user, assistant] = state.messages;
    expect(state.messages).toHaveLength(2);
    expect(user).toMatchObject({ role: "user", text: "hello", requestId: "r1" });
    expect(assistant).toMatchObject({ role: "assistant", text: "Echo: hello", status: "done" });
    expect(state.queued).toEqual([]);
    expect(runtime.isBusy(ref)).toBe(false);
    expect(runtime.busyConversations()).not.toContain(ref);
    const mine = activity.filter((change) => change.conversation === ref);
    expect(mine.some((change) => change.busy)).toBe(true);
    expect(mine.at(-1)).toMatchObject({ busy: false, approvals: 0, questions: 0 });
  }, 15_000);

  it("reports its Finished replies and the Bot list preview", async () => {
    const { runtime, ref, reply } = await setup(kind);
    expect(await runtime.lastMessage(ref)).toBeUndefined();
    await reply("first", "r1");
    await reply("second", "r2");
    expect((await runtime.finishedReplies(ref)).map((r) => r.text)).toEqual([
      "Echo: first",
      "Echo: second",
    ]);
    expect(await runtime.lastMessage(ref)).toMatchObject({
      role: "assistant",
      text: "Echo: second",
      createdAt: expect.any(Number),
    });
  }, 15_000);

  it("keeps who sent a message: a peer delivery, or an author in a shared chat", async () => {
    const { ref, send, replied } = await setup(kind);
    await send(ref, {
      requestId: "r1",
      text: "Scout says hi",
      peer: { kind: "message", name: "Scout" },
    });
    await replied("Scout says hi");
    await send(ref, {
      requestId: "r2",
      text: "Gus: hello all",
      author: { id: 7, name: "Gus" },
    });
    const state = await replied("Gus: hello all");
    expect(state.messages[0]).toMatchObject({
      role: "user",
      requestId: "r1",
      peer: { kind: "message", name: "Scout" },
    });
    expect(state.messages[2]).toMatchObject({
      role: "user",
      requestId: "r2",
      author: { id: 7, name: "Gus" },
    });
  }, 15_000);

  it("streams a snapshot first, then the reply", async () => {
    const { runtime, ref, send } = await setup(kind);
    const chat = await watch(runtime, ref);
    expect(chat.events[0]).toMatchObject({ type: "snapshot", state: { messages: [] } });
    await send(ref, { requestId: "r1", text: "hi" });
    await until(() => {
      const state = chat.state();
      return !state?.busy && state?.messages.at(-1)?.text === "Echo: hi";
    }, "the streamed reply");
    expect(chat.state()?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    await chat.stop();
  }, 15_000);

  it("windows a stream's snapshot and pages the messages before it", async () => {
    const { runtime, ref, reply } = await setup(kind);
    await reply("one", "r1");
    await reply("two", "r2");
    await reply("three", "r3");

    const windowed = await runtime.watchChat(ref, () => undefined, { window: 2 });
    expect(windowed.initial.messages.map((m) => m.text)).toEqual(["three", "Echo: three"]);
    expect(windowed.initial.hasMore).toBe(true);
    const cursor = windowed.initial.cursor!;
    expect(cursor).toBe(windowed.initial.messages[0]?.id);
    await windowed.stop();

    const older = await runtime.readChatPage(ref, { before: cursor, limit: 3 });
    expect(older?.messages.map((m) => m.text)).toEqual(["Echo: one", "two", "Echo: two"]);
    expect(older?.hasMore).toBe(true);
    const oldest = await runtime.readChatPage(ref, { before: older!.messages[0]!.id, limit: 3 });
    expect(oldest).toMatchObject({ hasMore: false });
    expect(oldest?.messages.map((m) => m.text)).toEqual(["one"]);
    expect(await runtime.readChatPage(ref, { before: "no-such-message", limit: 3 })).toBe(
      undefined,
    );
  }, 20_000);

  it("keeps the history when reconfigured", async () => {
    const { runtime, ref, reply, config } = await setup(kind);
    await reply("before", "r1");
    await runtime.configure(ref, config("Be thorough."));
    const state = await reply("after", "r2");
    expect(state.messages.map((m) => m.text)).toEqual([
      "before",
      "Echo: before",
      "after",
      "Echo: after",
    ]);
  }, 15_000);

  it("is busy while a call waits on the owner, and stops when aborted", async () => {
    const { runtime, ref, send } = await setup(kind);
    const chat = await watch(runtime, ref);
    await send(ref, { requestId: "r1", text: "send_email ana@x.dev" });
    await awaitingApproval(chat, "send_email");
    expect(runtime.isBusy(ref)).toBe(true);
    expect(runtime.busyConversations()).toContain(ref);
    await runtime.abort(ref);
    await until(() => !runtime.isBusy(ref), "the reply to stop");
    expect((await runtime.readChat(ref)).busy).toBe(false);
  }, 15_000);

  it("admits a retried request id once", async () => {
    const { runtime, worker, ref, send, replied } = await setup(kind);
    await send(ref, { requestId: "r1", text: "hello" });
    await send(ref, { requestId: "r1", text: "hello" });
    await replied("hello");
    await send(ref, { requestId: "r1", text: "hello" });
    await until(() => !runtime.isBusy(ref), "the conversation to stay idle");
    const state = await runtime.readChat(ref);
    expect(state.messages.map((m) => [m.role, m.text, m.requestId])).toEqual([
      ["user", "hello", "r1"],
      ["assistant", "Echo: hello", undefined],
    ]);
    if (kind === "claude-code") expect(worker.turns.map((turn) => turn.text)).toEqual(["hello"]);
  }, 15_000);

  it("answers a message sent while a reply runs with the next turn, in order", async () => {
    const { runtime, worker, ref, send, replied } = await setup(kind);
    const chat = await watch(runtime, ref);
    await send(ref, { requestId: "r1", text: "send_email ana@x.dev" });
    const waiting = await awaitingApproval(chat, "send_email");
    await send(ref, { requestId: "r2", text: "two" });
    const busy = await runtime.readChat(ref);
    expect(busy.busy).toBe(true);
    expect(busy.queued).toEqual([expect.objectContaining({ requestId: "r2", text: "two" })]);
    expect(busy.messages.some((m) => m.requestId === "r2")).toBe(false);

    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    const state = await replied("two");
    expect(state.queued).toEqual([]);
    const texts = state.messages.map((m) => m.text);
    expect(texts.filter((_, i) => state.messages[i]!.role === "user")).toEqual([
      "send_email ana@x.dev",
      "two",
    ]);
    expect(texts.indexOf("RESULT:Sent to ana@x.dev")).toBeLessThan(texts.indexOf("two"));
    expect(finishedReplyTo(state, "r1")).toMatchObject({
      status: "answered",
      reply: { text: "RESULT:Sent to ana@x.dev" },
    });
    expect(finishedReplyTo(state, "r2")).toMatchObject({
      status: "answered",
      reply: { text: "Echo: two" },
    });
    if (kind === "claude-code") {
      expect(worker.turns.map((turn) => turn.text)).toEqual(["send_email ana@x.dev", "two"]);
    }
    await chat.stop();
  }, 15_000);

  it("withdraws a message still waiting for its turn, and only that one", async () => {
    const { runtime, ref, send } = await setup(kind);
    const chat = await watch(runtime, ref);
    await send(ref, { requestId: "r1", text: "send_email ana@x.dev" });
    const waiting = await awaitingApproval(chat, "send_email");
    await send(ref, { requestId: "r2", text: "two" });
    expect(await runtime.withdraw(ref, "r2")).toBe("withdrawn");
    expect(await runtime.withdraw(ref, "r1")).toBe("already_placed");
    expect((await runtime.readChat(ref)).queued).toEqual([]);

    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    const state = await until(async () => {
      const read = await runtime.readChat(ref);
      return !read.busy && read.messages.at(-1)?.text === "RESULT:Sent to ana@x.dev"
        ? read
        : undefined;
    }, "the first reply");
    expect(state.messages.filter((m) => m.role === "user").map((m) => m.text)).toEqual([
      "send_email ana@x.dev",
    ]);
    expect(await runtime.withdraw(ref, "r1")).toBe("settled");
    expect(await runtime.withdraw(ref, "r2")).toBe("withdrawn");
    expect(await runtime.withdraw(ref, "nope")).toBe("not_found");
    await chat.stop();
  }, 15_000);

  it("keeps a stopped reply as it stopped, whatever arrives for it later", async () => {
    const { runtime, worker, ref, send } = await setup(kind);
    const chat = await watch(runtime, ref);
    await send(ref, { requestId: "r1", text: "send_email ana@x.dev" });
    await awaitingApproval(chat, "send_email");
    await runtime.abort(ref);
    await until(() => !runtime.isBusy(ref), "the reply to stop");
    const stopped = (await runtime.readChat(ref)).messages.at(-1);
    if (kind === "claude-code") {
      expect(stopped).toMatchObject({ role: "assistant", status: "stopped" });
      expect(stopped?.toolCalls).toEqual([
        expect.objectContaining({ name: "send_email", status: "aborted" }),
      ]);
      await until(() => worker.ended.includes("r1"), "the stopped turn's late events");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const after = await runtime.readChat(ref);
    expect(after.messages.at(-1)).toEqual(stopped);
    expect(after.busy).toBe(false);
    expect(runtime.isBusy(ref)).toBe(false);
    await chat.stop();
  }, 15_000);

  it("finishes a reply with nothing in it, so its request has a Finished reply", async () => {
    const { runtime, ref, send } = await setup(kind);
    await send(ref, { requestId: "r1", text: SILENT });
    const state = await until(async () => {
      const read = await runtime.readChat(ref);
      return !read.busy && read.messages.at(-1)?.role === "assistant" ? read : undefined;
    }, "the empty reply");
    expect(state.messages.at(-1)).toMatchObject({ role: "assistant", text: "", status: "done" });
    expect(finishedReplyTo(state, "r1")).toMatchObject({ status: "answered", reply: { text: "" } });
    expect(await runtime.finishedReplies(ref)).toEqual([]);
  }, 15_000);

  it("keeps the transcript across a restart, and the same engine answers", async () => {
    const storePath = await storeFile();
    const config = {
      modelId: kind === "pi" ? TEST_MODEL : "claude-sonnet",
      systemPrompt: "Be brief.",
    };
    const first = await openEngine(kind, { storePath });
    const ref = await first.runtime.createConversation(config);
    await first.send(ref, { requestId: "r1", text: "before" });
    await until(async () => {
      const state = await first.runtime.readChat(ref);
      return !state.busy && state.messages.at(-1)?.text === "Echo: before";
    }, "the reply before the restart");
    await first.runtime.close();

    const second = await openEngine(kind, { storePath });
    runtimes.push(second.runtime);
    const read = await second.runtime.readChat(ref);
    expect(read.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "before"],
      ["assistant", "Echo: before"],
    ]);
    expect(await second.runtime.lastMessage(ref)).toMatchObject({ text: "Echo: before" });

    await second.runtime.configure(ref, config);
    await second.send(ref, { requestId: "r2", text: "after" });
    const state = await until(async () => {
      const current = await second.runtime.readChat(ref);
      return !current.busy && current.messages.at(-1)?.text === "Echo: after" ? current : undefined;
    }, "the reply after the restart");
    expect(state.messages.map((m) => m.text)).toEqual([
      "before",
      "Echo: before",
      "after",
      "Echo: after",
    ]);
    if (kind === "claude-code") {
      expect(second.worker.turns).toEqual([
        expect.objectContaining({ text: "after", resume: `claude-${ref}` }),
      ]);
    }
  }, 20_000);
});

const questions = [{ question: "Which repo?", options: [{ label: "web" }, { label: "api" }] }];
const request = {
  origin: "https://shop.dev",
  title: "Shop login",
  purpose: "Sign in",
  fields: [{ key: "username", label: "Username", type: "text", required: true }],
};

const CARDS = [
  {
    tool: "ask_questions",
    pending: { question: "pending", questions },
    done: { question: "answered", questions, answers: [{ selected: ["web"] }] },
    waiting: {
      status: "awaiting_answer",
      questions,
    } satisfies Partial<ChatToolCall>,
    finished: { status: "done", questions, answers: [{ selected: ["web"] }] },
  },
  {
    tool: "request_login",
    pending: { credentials: "pending", request, expiresAt: 4_102_444_800_000 },
    done: { credentials: "filled", request, filled: ["username"] },
    waiting: {
      status: "awaiting_credentials",
      credentials: { status: "pending", ...request },
      expiresAt: 4_102_444_800_000,
    } satisfies Partial<ChatToolCall>,
    finished: {
      status: "done",
      credentials: { status: "filled", ...request, filled: ["username"] },
    },
  },
  {
    tool: "hand_over",
    pending: { takeover: { status: "pending", reason: "Solve the captcha" } },
    done: { takeover: { status: "released", reason: "Solve the captcha" } },
    waiting: {
      status: "awaiting_takeover",
      takeover: { status: "pending", reason: "Solve the captcha" },
    } satisfies Partial<ChatToolCall>,
    finished: { status: "done", takeover: { status: "released", reason: "Solve the captcha" } },
  },
] as const;

function cardsCapability(release: Map<string, () => void>): Capability {
  const tools = CARDS.map((card) =>
    defineTool({
      name: card.tool,
      description: card.tool,
      parameters: Type.Object({}),
      execute: async (_args, api, context) => {
        await api.details(card.pending as never, context);
        await new Promise<void>((resolve) => release.set(card.tool, resolve));
        return {
          output: [{ type: "text" as const, text: "answered" }],
          details: card.done as never,
        };
      },
    }),
  );
  return {
    id: "cards",
    kind: "toolkit",
    name: "Cards",
    description: "Owner wait cards",
    extension: defineExtension({ name: "cards", tools }),
    tools: CARDS.map((card) => ({
      name: card.tool,
      label: card.tool,
      description: card.tool,
      readOnly: true,
    })),
  };
}

describe.each(ENGINES)("Owner wait cards on %s", (kind) => {
  it.each(CARDS)(
    "shows $tool's card while it waits, then its answer",
    async (card) => {
      const release = new Map<string, () => void>();
      const engine = await openEngine(kind, { capabilities: [cardsCapability(release)] });
      runtimes.push(engine.runtime);
      const { runtime } = engine;
      const ref = await runtime.createConversation({
        modelId: engine.modelId,
        systemPrompt: "Be brief.",
        capabilities: { enabled: ["cards"], permissions: {} },
      });
      const chat = await watch(runtime, ref);
      await engine.send(ref, { requestId: "r1", text: card.tool });

      const waiting = await until(() => {
        const call = chat.toolCall(card.tool);
        return call?.status === card.waiting.status ? call : undefined;
      }, `${card.tool}'s card`);
      expect(waiting).toMatchObject({ ...card.waiting, taskId: expect.any(Number) });

      release.get(card.tool)?.();
      await until(() => chat.results().length > 0, `${card.tool}'s result`);
      const finished = chat.toolCall(card.tool);
      expect(finished).toMatchObject({ ...card.finished, output: "answered" });
      expect(finished).not.toHaveProperty("expiresAt");
      expect(finished).not.toHaveProperty("taskId");
      await chat.stop();
    },
    15_000,
  );
});

describe("importing the Claude plan's old .claude.json", () => {
  const onClaude = { modelId: "claude-sonnet", systemPrompt: "Be brief." };

  async function storeWithConversation() {
    const storePath = await storeFile();
    const first = await openEngine("claude-code", { storePath });
    const ref = await first.runtime.createConversation(onClaude);
    const piRef = await first.runtime.createConversation(onClaude);
    await first.runtime.close();
    return { storePath, ref, piRef };
  }

  it("imports the file into entries once, then renames it", async () => {
    const { storePath, ref, piRef } = await storeWithConversation();
    const legacy = `${storePath}.claude.json`;
    const messages = [
      { id: "u-1", role: "user", text: "remember the number 42", status: "done", createdAt: 1 },
      { id: "a-1", role: "assistant", text: "Got it.", status: "done", createdAt: 2 },
      { id: "u-1", role: "user", text: "remember the number 42", status: "done", createdAt: 3 },
      { id: "a-1", role: "assistant", text: "Got it again.", status: "done", createdAt: 4 },
    ];
    await writeFile(
      legacy,
      JSON.stringify({
        sessions: {
          [String(ref)]: {
            model: "claude-sonnet-4-6",
            surface: "claude",
            claudeSessionId: "sess-abc",
            messages,
            nextTask: 2_000_000_005,
          },
          [String(piRef)]: { surface: "pi", messages: [] },
          "999999": { surface: "claude", messages },
        },
      }),
    );

    const second = await openEngine("claude-code", { storePath });
    runtimes.push(second.runtime);
    const expected = [
      { id: "u-1", role: "user", text: "remember the number 42", requestId: "1" },
      { id: "a-1", role: "assistant", text: "Got it.", status: "done" },
    ];
    const state = await second.runtime.readChat(ref);
    expect(state.messages).toEqual([
      expect.objectContaining(expected[0]),
      expect.objectContaining(expected[1]),
    ]);
    await expect(stat(legacy)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(`${legacy}.imported`, "utf8")).sessions).toBeDefined();

    await second.runtime.configure(ref, onClaude);
    await second.send(ref, { requestId: "r2", text: "still there?" });
    await until(async () => {
      const current = await second.runtime.readChat(ref);
      return !current.busy && current.messages.at(-1)?.text === "Echo: still there?";
    }, "the reply after the import");
    expect(second.worker.turns).toEqual([
      expect.objectContaining({ text: "still there?", resume: "sess-abc" }),
    ]);
    await second.runtime.configure(piRef, onClaude);
    await second.send(piRef, { requestId: "p1", text: "on pi" });
    await until(async () => {
      const current = await second.runtime.readChat(piRef);
      return !current.busy && current.messages.at(-1)?.text === "Echo: on pi";
    }, "the pi reply");
    expect(second.worker.turns).toHaveLength(1);
    await second.runtime.close();

    const third = await openEngine("claude-code", { storePath });
    runtimes.push(third.runtime);
    expect((await third.runtime.readChat(ref)).messages.map((m) => m.text)).toEqual([
      "remember the number 42",
      "Got it.",
      "still there?",
      "Echo: still there?",
    ]);
  }, 20_000);

  it("shows a message whose turn a restart cut off as unanswered", async () => {
    const storePath = await storeFile();
    const first = await openEngine("claude-code", { storePath });
    const ref = await first.runtime.createConversation(onClaude);
    first.worker.hold();
    await first.send(ref, { requestId: "r1", text: "hello" });
    await until(() => first.worker.turns.length === 1, "the worker to get the turn");
    await first.runtime.close();

    const second = await openEngine("claude-code", { storePath });
    runtimes.push(second.runtime);
    const state = await second.runtime.readChat(ref);
    expect(state.busy).toBe(false);
    expect(state.messages).toEqual([
      expect.objectContaining({
        role: "user",
        text: "hello",
        status: "unanswered",
        error: "No reply was produced for this message.",
      }),
    ]);
  }, 20_000);

  it("leaves a file it cannot read as it is, and says so", async () => {
    const { storePath, ref } = await storeWithConversation();
    const legacy = `${storePath}.claude.json`;
    await writeFile(legacy, "{ not json");
    const reports: unknown[] = [];
    const second = await openEngine("claude-code", {
      storePath,
      onReport: (error) => reports.push(error),
    });
    runtimes.push(second.runtime);
    expect((await second.runtime.readChat(ref)).messages).toEqual([]);
    expect(await readFile(legacy, "utf8")).toBe("{ not json");
    await expect(stat(`${legacy}.imported`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(String(reports[0])).toMatch(/left as it is/);
  }, 20_000);
});

describe("choosing the engine", () => {
  it("runs a Claude plan conversation on the worker, and a pi one on the harness", async () => {
    const { runtime, worker, ref, reply, config } = await setup("claude-code");
    await reply("plan", "r1");
    expect(worker.turns.map((turn) => turn.text)).toEqual(["plan"]);

    const piRef = await runtime.createConversation(config("Be brief.", TEST_MODEL));
    await runtime.submit(piRef, { requestId: "r2", text: "gateway" });
    await until(async () => {
      const state = await runtime.readChat(piRef);
      return !state.busy && state.messages.at(-1)?.text === "Echo: gateway";
    }, "the pi reply");
    expect(worker.turns).toHaveLength(1);
    expect(ref).not.toBe(piRef);
  }, 15_000);

  it("pauses a Claude plan turn when the engine is off, without opening a socket", async () => {
    const { runtime, worker, ref } = await setup("claude-code");
    runtime.applyModelConfig(engineModelConfig({ enabled: false }));
    await runtime.submit(ref, { requestId: "r1", text: "hi" });
    const state = await runtime.readChat(ref);
    expect(state.messages.at(-1)?.error).toMatch(/Claude plan is turned off/);
    expect(state.messages[0]).toMatchObject({ role: "user", text: "hi", requestId: "r1" });
    expect(finishedReplyTo(state, "r1")).toMatchObject({ status: "answered" });
    expect(worker.turns).toEqual([]);
  }, 15_000);

  it("falls back to the gateway once and stays there", async () => {
    const { runtime, worker, ref, config } = await setup("claude-code");
    runtime.applyModelConfig(engineModelConfig({ enabled: false, fallback: true }));
    await runtime.submit(ref, { requestId: "r1", text: "first" });
    await until(async () => {
      const state = await runtime.readChat(ref);
      return !state.busy && state.messages.at(-1)?.text === "Echo: first";
    }, "the gateway reply");

    runtime.applyModelConfig(engineModelConfig({ fallback: true }));
    await runtime.configure(ref, config());
    await runtime.submit(ref, { requestId: "r2", text: "second" });
    await until(async () => {
      const state = await runtime.readChat(ref);
      return !state.busy && state.messages.at(-1)?.text === "Echo: second";
    }, "the second reply");
    expect(worker.turns).toEqual([]);
  }, 15_000);

  it("moves a conversation onto pi when its bot leaves the Claude plan model", async () => {
    const { runtime, worker, ref, reply, config } = await setup("claude-code");
    await reply("on the plan", "r1");
    await runtime.configure(ref, config("Be brief.", TEST_MODEL));
    await runtime.submit(ref, { requestId: "r2", text: "on pi" });
    await until(async () => {
      const state = await runtime.readChat(ref);
      return !state.busy && state.messages.at(-1)?.text === "Echo: on pi";
    }, "the pi reply");
    expect(worker.turns.map((turn) => turn.text)).toEqual(["on the plan"]);
  }, 15_000);
});
