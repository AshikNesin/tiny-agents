import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { EntryRecord } from "@earendil-works/pi-durable";
import {
  chatState,
  deriveChat,
  diffChat,
  StoreLockedError,
  type ChatEvent,
  type ChatMessage,
  type ChatState,
  type RawChat,
} from "../../../../packages/agent/src/index";
import { openTestRuntime, TEST_MODEL, TEST_MODEL_2 } from "../../../../packages/agent/src/testing";

const TEST_TIMEOUT_MS = 8_000;

async function waitUntil(
  check: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = TEST_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function applyEvents(previous: ChatState, events: readonly ChatEvent[]): ChatState {
  let state = structuredClone(previous);
  for (const event of events) {
    switch (event.type) {
      case "snapshot":
        state = structuredClone(event.state);
        break;
      case "upsert":
        state = {
          ...state,
          messages: [
            ...state.messages.filter((message) => message.id !== event.message.id),
            event.message,
          ],
        };
        break;
      case "remove":
        state = { ...state, messages: state.messages.filter((message) => message.id !== event.id) };
        break;
      case "delta":
        state = {
          ...state,
          messages: state.messages.map((message) =>
            message.id === event.id
              ? {
                  ...message,
                  text: message.text + (event.text ?? ""),
                  ...(event.reasoning
                    ? { reasoning: (message.reasoning ?? "") + event.reasoning }
                    : {}),
                }
              : message,
          ),
        };
        break;
      case "busy":
        state = { ...state, busy: event.busy };
        break;
    }
  }
  return state;
}

async function observeChat(
  runtime: Awaited<ReturnType<typeof openTestRuntime>>,
  ref: number,
): Promise<{
  batches: ChatEvent[][];
  state: () => ChatState;
  stop: () => Promise<void>;
}> {
  const batches: ChatEvent[][] = [];
  let current: ChatState = { messages: [], busy: false };
  const subscription = await runtime.watchChat(ref, (events) => {
    batches.push([...events]);
    current = applyEvents(current, events);
  });
  return { batches, state: () => current, stop: () => subscription.stop() };
}

function userEntry(id: number, text: string): EntryRecord {
  return {
    id,
    conversationId: 1,
    kind: "pi.user",
    model: [{ role: "user", content: text, timestamp: id * 1_000 }],
  } as EntryRecord;
}

function assistantEntry(
  id: number,
  text: string,
  stopReason: "stop" | "aborted" = "stop",
): EntryRecord {
  return {
    id,
    conversationId: 1,
    kind: "pi.assistant",
    model: [
      {
        role: "assistant",
        content: [{ type: "text", text }],
        api: "faux",
        provider: "faux",
        model: TEST_MODEL,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason,
        timestamp: id * 1_000,
      },
    ],
  } as EntryRecord;
}

function compactionEntry(id: number, head?: number): EntryRecord {
  return {
    id,
    conversationId: 1,
    kind: "pi.compaction",
    ...(head === undefined ? {} : { head }),
  } as EntryRecord;
}

function rawChat(entries: readonly EntryRecord[], overrides: Partial<RawChat> = {}): RawChat {
  return {
    entries,
    busy: false,
    unanswered: new Map(),
    ...overrides,
  };
}

function assistantMessage(text: string): ChatMessage {
  return {
    id: "live",
    role: "assistant",
    text,
    status: "streaming",
    model: TEST_MODEL,
    createdAt: 1,
  };
}

describe("AgentRuntime", () => {
  it("creates, configures, streams, and clears its busy flag after a reply", async () => {
    const runtime = await openTestRuntime({ storePath: ":memory:", tokensPerSecond: 5 });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      await runtime.configure(ref, {
        modelId: TEST_MODEL_2,
        systemPrompt: "Reply as an echo bot.",
      });
      const chat = await observeChat(runtime, ref);

      expect(chat.batches[0]).toEqual([{ type: "snapshot", state: { messages: [], busy: false } }]);

      await runtime.submit(ref, { requestId: "first-send", text: "hello runtime" });
      await waitUntil(() => runtime.isBusy(ref), "the runtime to become busy");
      expect(runtime.isBusy(ref)).toBe(true);

      await waitUntil(
        () =>
          !chat.state().busy &&
          chat
            .state()
            .messages.some(
              (message) =>
                message.role === "assistant" &&
                message.status === "done" &&
                message.text === "Echo: hello runtime",
            ),
        "the streamed assistant reply to complete",
      );

      expect(chat.batches.flat()[0]).toMatchObject({ type: "snapshot" });
      expect(chat.batches.flat().some((event) => event.type === "upsert")).toBe(true);
      expect(runtime.isBusy(ref)).toBe(false);
      expect(chat.state().messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: "user", text: "hello runtime" }),
          expect.objectContaining({
            role: "assistant",
            status: "done",
            text: "Echo: hello runtime",
          }),
        ]),
      );

      await chat.stop();
    } finally {
      await runtime.close();
    }
  });

  it("deduplicates repeated request IDs", async () => {
    const runtime = await openTestRuntime({ storePath: ":memory:" });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      const chat = await observeChat(runtime, ref);

      await runtime.submit(ref, { requestId: "retry-safe", text: "only once" });
      await runtime.submit(ref, { requestId: "retry-safe", text: "only once" });
      await waitUntil(() => !chat.state().busy && chat.state().messages.length === 2, "one reply");

      expect(chat.state().messages.filter((message) => message.role === "user")).toHaveLength(1);
      expect(chat.state().messages.filter((message) => message.role === "assistant")).toHaveLength(
        1,
      );
      expect(chat.state().messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: "assistant", text: "Echo: only once", status: "done" }),
        ]),
      );

      await chat.stop();
    } finally {
      await runtime.close();
    }
  });

  it(
    "shows a stopped or unanswered terminal state after aborting a streamed reply",
    { timeout: 15_000 },
    async () => {
      const runtime = await openTestRuntime({
        storePath: ":memory:",
        tokensPerSecond: 1,
        reply: () => "one two three four five six seven eight nine ten eleven twelve",
      });
      try {
        const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
        const chat = await observeChat(runtime, ref);

        await runtime.submit(ref, { requestId: "abort-me", text: "start slowly" });
        await waitUntil(
          () => chat.state().messages.some((message) => message.status === "streaming"),
          "the assistant to begin streaming",
        );

        await expect(runtime.abort(ref)).resolves.toBeUndefined();
        await waitUntil(() => !chat.state().busy, "the abort to settle");

        expect(
          chat
            .state()
            .messages.some(
              (message) =>
                message.status === "stopped" ||
                (message.role === "user" && message.status === "unanswered"),
            ),
        ).toBe(true);

        await chat.stop();
      } finally {
        await runtime.close();
      }
    },
  );

  it("keeps the old conversation watchable when reset creates a new conversation", async () => {
    const runtime = await openTestRuntime({ storePath: ":memory:" });
    try {
      const oldRef = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      const oldChat = await observeChat(runtime, oldRef);
      await runtime.submit(oldRef, { requestId: "old-message", text: "history survives" });
      await waitUntil(
        () => !oldChat.state().busy && oldChat.state().messages.length === 2,
        "old reply",
      );

      const freshRef = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      expect(freshRef).not.toBe(oldRef);

      const freshChat = await observeChat(runtime, freshRef);
      expect(freshChat.state().messages).toEqual([]);
      expect(oldChat.state().messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: "user", text: "history survives" }),
          expect.objectContaining({ role: "assistant", text: "Echo: history survives" }),
        ]),
      );

      await Promise.all([oldChat.stop(), freshChat.stop()]);
    } finally {
      await runtime.close();
    }
  });

  it("gives a later watcher a complete fresh snapshot", async () => {
    const runtime = await openTestRuntime({ storePath: ":memory:" });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      const first = await observeChat(runtime, ref);
      await runtime.submit(ref, { requestId: "history", text: "persist this history" });
      await waitUntil(
        () => !first.state().busy && first.state().messages.length === 2,
        "first reply",
      );

      const second = await observeChat(runtime, ref);
      expect(second.batches).toHaveLength(1);
      expect(second.batches[0][0]).toMatchObject({
        type: "snapshot",
        state: {
          busy: false,
          messages: [
            expect.objectContaining({ role: "user", text: "persist this history" }),
            expect.objectContaining({ role: "assistant", text: "Echo: persist this history" }),
          ],
        },
      });

      await Promise.all([first.stop(), second.stop()]);
    } finally {
      await runtime.close();
    }
  });

  it("rejects a second runtime that tries to own the same durable store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tiny-agents-lock-"));
    const storePath = join(directory, "agent.db");
    const first = await openTestRuntime({ storePath, lockWaitMs: 10 });
    try {
      await expect(openTestRuntime({ storePath, lockWaitMs: 10 })).rejects.toBeInstanceOf(
        StoreLockedError,
      );
    } finally {
      await first.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("transcript derivation", () => {
  it("places compaction markers before the first retained entry", () => {
    const messages = deriveChat(
      rawChat([
        userEntry(1, "old question"),
        assistantEntry(2, "old answer"),
        compactionEntry(3, 4),
        userEntry(4, "current question"),
        assistantEntry(5, "current answer"),
      ]),
    );

    expect(messages.map((message) => [message.id, message.role, message.text])).toEqual([
      ["e1", "user", "old question"],
      ["e2", "assistant", "old answer"],
      ["e3", "marker", "Earlier messages summarized"],
      ["e4", "user", "current question"],
      ["e5", "assistant", "current answer"],
    ]);
  });

  it("hides an aborted assistant entry when its replacement is present", () => {
    const messages = deriveChat(
      rawChat([
        userEntry(1, "question"),
        assistantEntry(2, "cut off", "aborted"),
        assistantEntry(3, "replacement"),
      ]),
    );

    expect(messages.map((message) => message.text)).toEqual(["question", "replacement"]);
    expect(messages.find((message) => message.id === "e2")).toBeUndefined();
  });

  it("flags a settled user message with no answer", () => {
    const state = chatState(
      rawChat([userEntry(1, "will not be answered")], {
        unanswered: new Map([[1, "aborted"]]),
      }),
    );

    expect(state).toMatchObject({
      busy: false,
      messages: [
        {
          id: "e1",
          role: "user",
          status: "unanswered",
          error: "Stopped before a reply started.",
        },
      ],
    });
  });

  it("emits deltas for append-only text and upserts for a changed message", () => {
    const previous: ChatState = { messages: [assistantMessage("Hel")], busy: true };
    const appended: ChatState = { messages: [assistantMessage("Hello")], busy: true };
    const changed: ChatState = { messages: [assistantMessage("Howdy")], busy: true };

    expect(diffChat(previous, appended)).toEqual([{ type: "delta", id: "live", text: "lo" }]);
    expect(diffChat(previous, changed)).toEqual([
      { type: "upsert", message: assistantMessage("Howdy") },
    ]);
  });
});
