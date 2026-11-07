/**
 * The AgentEngine contract (ADR 0014), through AgentRuntime: every case
 * runs once on pi (the faux model) and once on the Claude plan engine (a
 * fake worker socket). The runtime picks the engine per conversation; what
 * its callers read (chat state, streams, pages, the Bot list preview, busy
 * activity, Finished replies) must not depend on which one runs.
 */
import { Type } from "@earendil-works/pi-ai";
import { until } from "../../fixtures/until";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import { TEST_MODEL } from "../../../../packages/agent/src/testing";
import type { ActivityChange, ChatToolCall } from "../../../../packages/agent/src/types";
import {
  awaitingApproval,
  engineModelConfig,
  ENGINES,
  mailCapability,
  openEngine,
  watch,
  type EngineKind,
} from "./engine-harness";

const runtimes: AgentRuntime[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
  vi.unstubAllEnvs();
});

async function setup(kind: EngineKind) {
  const engine = await openEngine(kind, { capabilities: [mailCapability([])] });
  runtimes.push(engine.runtime);
  const config = (systemPrompt = "Be brief.", modelId = engine.modelId) => ({
    modelId,
    systemPrompt,
    capabilities: { enabled: ["mail"], permissions: {} },
  });
  const ref = await engine.runtime.createConversation(config());
  /** The chat once it is idle with `text`'s echo as its newest message. */
  const replied = (text: string, conversation = ref) =>
    until(async () => {
      const state = await engine.runtime.readChat(conversation);
      const last = state.messages.at(-1);
      return !state.busy && last?.role === "assistant" && last.text === `Echo: ${text}`
        ? state
        : undefined;
    }, `the reply to ${text}`);
  /** Send a message and wait for its reply. */
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
});

// ── Owner wait cards ────────────────────────────────────────────────────

const questions = [{ question: "Which repo?", options: [{ label: "web" }, { label: "api" }] }];
const request = {
  origin: "https://shop.dev",
  title: "Shop login",
  purpose: "Sign in",
  fields: [{ key: "username", label: "Username", type: "text", required: true }],
};

/**
 * One tool per Owner wait card that is not an approval: each publishes the
 * card's pending details (the shape its wait kind writes), holds until the
 * test lets it go, then finishes with the card's answered details.
 */
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

    // The latch holds even once the engine is back and the bot is reconfigured.
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
