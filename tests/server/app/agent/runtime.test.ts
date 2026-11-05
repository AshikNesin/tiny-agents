import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { InboxItem, SubmissionRecord } from "@earendil-works/pi-durable";
import type { EntryRecord } from "@earendil-works/pi-durable";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  chatState,
  deriveChat,
  diffChat,
  queuedOf,
  CHAT_USER_ENTRY,
  type RawChat,
} from "../../../../packages/agent/src/transcript";
import {
  finishedReplyTo,
  pageBefore,
  windowChat,
  type ChatEvent,
  type ChatMessage,
  type ChatState,
} from "../../../../packages/agent/src/index";
import { StoreLockedError } from "../../../../packages/agent/src/lock";
import {
  fauxAssistantMessage,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";

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
      case "queued":
        state = { ...state, queued: event.items };
        break;
    }
  }
  return state;
}

async function observeChat(
  runtime: Awaited<ReturnType<typeof openTestRuntime>>,
  ref: number,
  options: { window?: number } = {},
): Promise<{
  batches: ChatEvent[][];
  state: () => ChatState;
  stop: () => Promise<void>;
}> {
  const batches: ChatEvent[][] = [];
  let current: ChatState = { messages: [], busy: false, queued: [] };
  const subscription = await runtime.watchChat(
    ref,
    (events) => {
      batches.push([...events]);
      current = applyEvents(current, events);
    },
    options,
  );
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
    "steers a running reply: the message queues, joins the reply, and is answered",
    { timeout: 20_000 },
    async () => {
      const runtime = await openTestRuntime({
        storePath: ":memory:",
        tokensPerSecond: 5,
        reply: (text) => `Reply to ${text}, padded for a slow stream`,
      });
      try {
        const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
        const chat = await observeChat(runtime, ref);

        await runtime.submit(ref, { requestId: "steer-1", text: "start a slow reply" });
        await waitUntil(() => chat.state().busy, "the run to start");

        // Sent while busy: the message is durably held, not lost.
        await runtime.submit(ref, {
          requestId: "steer-2",
          text: "steer me",
          whenBusy: "steer",
        });
        await waitUntil(
          () => chat.state().queued.some((item) => item.requestId === "steer-2"),
          "the steer to appear in the queue",
        );
        expect(chat.state().queued).toEqual([
          { requestId: "steer-2", mode: "steer", text: "steer me" },
        ]);

        // A watcher that attaches mid-queue sees it in its fresh snapshot
        // (a reload keeps showing the held message).
        const lateChat = await observeChat(runtime, ref);
        expect(lateChat.state().queued).toEqual([
          { requestId: "steer-2", mode: "steer", text: "steer me" },
        ]);

        // The steer joins the reply: placed as a user message and answered
        // in the same run, then the queue empties.
        await waitUntil(
          () =>
            chat
              .state()
              .messages.some((message) => message.role === "user" && message.text === "steer me") &&
            chat
              .state()
              .messages.some(
                (message) =>
                  message.role === "assistant" &&
                  message.text === "Reply to steer me, padded for a slow stream",
              ),
          "the steered reply",
        );
        await waitUntil(() => !chat.state().busy, "the run to end");
        expect(chat.state().queued).toEqual([]);

        await chat.stop();
        await lateChat.stop();
      } finally {
        await runtime.close();
      }
    },
  );

  it(
    "queues a follow-up behind a busy reply and answers it in the next run",
    { timeout: 20_000 },
    async () => {
      const runtime = await openTestRuntime({
        storePath: ":memory:",
        tokensPerSecond: 5,
        reply: (text) => `Reply to ${text}, padded for a slow stream`,
      });
      try {
        const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
        const chat = await observeChat(runtime, ref);

        await runtime.submit(ref, { requestId: "follow-1", text: "first" });
        await waitUntil(() => chat.state().busy, "the run to start");

        await runtime.submit(ref, {
          requestId: "follow-2",
          text: "after this",
          whenBusy: "followUp",
        });
        await waitUntil(
          () => chat.state().queued.some((item) => item.requestId === "follow-2"),
          "the follow-up to appear in the queue",
        );
        expect(chat.state().queued[0].mode).toBe("followUp");

        // The first run answers, then the follow-up places and starts the
        // next one — both messages end up answered in order.
        await waitUntil(
          () =>
            !chat.state().busy &&
            chat
              .state()
              .messages.some(
                (message) =>
                  message.role === "assistant" &&
                  message.text === "Reply to after this, padded for a slow stream",
              ),
          "the follow-up's reply",
        );
        const texts = chat.state().messages.map((message) => `${message.role}:${message.text}`);
        expect(texts).toEqual([
          "user:first",
          "assistant:Reply to first, padded for a slow stream",
          "user:after this",
          "assistant:Reply to after this, padded for a slow stream",
        ]);
        expect(chat.state().queued).toEqual([]);

        await chat.stop();
      } finally {
        await runtime.close();
      }
    },
  );

  it(
    "withdraws a queued message and reports placed, settled, and unknown inputs",
    { timeout: 20_000 },
    async () => {
      const runtime = await openTestRuntime({
        storePath: ":memory:",
        tokensPerSecond: 5,
        reply: () => "one two three four five six seven eight nine ten eleven twelve",
      });
      try {
        const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
        const chat = await observeChat(runtime, ref);

        await runtime.submit(ref, { requestId: "withdraw-1", text: "keep this one busy" });
        await waitUntil(() => chat.state().busy, "the run to start");

        await runtime.submit(ref, {
          requestId: "withdraw-2",
          text: "withdraw me",
          whenBusy: "followUp",
        });
        await waitUntil(
          () => chat.state().queued.some((item) => item.requestId === "withdraw-2"),
          "the message to queue",
        );

        // Withdrawn while queued: gone from the stream, never answered.
        expect(await runtime.withdraw(ref, "withdraw-2")).toBe("withdrawn");
        await waitUntil(() => chat.state().queued.length === 0, "the queue to clear");
        // Re-withdrawing the same input is idempotent, not a conflict.
        expect(await runtime.withdraw(ref, "withdraw-2")).toBe("withdrawn");
        expect(await runtime.withdraw(ref, "never-submitted")).toBe("not_found");

        // The run ends and answers "withdraw-1": its input is settled.
        await waitUntil(() => !chat.state().busy, "the run to end");
        expect(await runtime.withdraw(ref, "withdraw-1")).toBe("settled");

        // A placed input belongs to its run: withdrawal is refused with 409.
        await runtime.submit(ref, { requestId: "withdraw-3", text: "place me" });
        await waitUntil(() => chat.state().busy, "the placed run to start");
        expect(await runtime.withdraw(ref, "withdraw-3")).toBe("already_placed");

        await chat.stop();
      } finally {
        await runtime.close();
      }
    },
  );

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

  it(
    "resumes a reply interrupted by a restart and shows it exactly once",
    { timeout: 20_000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "tiny-agents-resume-"));
      const storePath = join(directory, "agent.db");
      try {
        // First process: a slow reply, killed (closed) mid-stream.
        const first = await openTestRuntime({
          storePath,
          tokensPerSecond: 2,
          reply: () => "one two three four five six seven eight nine ten",
        });
        const ref = await first.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
        const before = await observeChat(first, ref);
        await first.submit(ref, { requestId: "survive-restart", text: "keep going" });
        await waitUntil(
          () => before.state().messages.some((message) => message.status === "streaming"),
          "the reply to begin streaming",
        );
        await before.stop();
        await first.close();

        // Second process on the same store: resume() finishes the reply.
        const second = await openTestRuntime({ storePath, reply: () => "finished after restart" });
        try {
          const after = await observeChat(second, ref);
          await waitUntil(
            () =>
              !after.state().busy &&
              after
                .state()
                .messages.some(
                  (message) => message.role === "assistant" && message.status === "done",
                ),
            "the resumed reply to complete",
          );
          const messages = after.state().messages;
          expect(messages.filter((message) => message.role === "user")).toEqual([
            expect.objectContaining({ text: "keep going", status: "done" }),
          ]);
          // The cut-off attempt is hidden; only the resumed answer shows.
          expect(messages.filter((message) => message.role === "assistant")).toEqual([
            expect.objectContaining({ text: "finished after restart", status: "done" }),
          ]);
          // Retrying the same send after the restart does not submit twice.
          await second.submit(ref, { requestId: "survive-restart", text: "keep going" });
          expect(second.isBusy(ref)).toBe(false);
          await after.stop();
        } finally {
          await second.close();
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("snapshots the whole transcript of a long conversation", { timeout: 60_000 }, async () => {
    const runtime = await openTestRuntime({ storePath: ":memory:" });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      // > 1 storage page (500 entries) of user + assistant entries.
      const turns = 300;
      for (let i = 0; i < turns; i++) {
        await runtime.submit(ref, { requestId: `long-${i}`, text: `message ${i}` });
      }
      await waitUntil(
        async () => (await runtime.lastMessage(ref))?.text === `Echo: message ${turns - 1}`,
        "every queued message to be answered",
        50_000,
      );
      const chat = await observeChat(runtime, ref);
      const messages = chat.state().messages;
      expect(messages.filter((m) => m.role === "user")).toHaveLength(turns);
      expect(messages[0]).toMatchObject({ role: "user", text: "message 0" });
      expect(messages.at(-1)).toMatchObject({
        role: "assistant",
        text: `Echo: message ${turns - 1}`,
      });
      await chat.stop();
    } finally {
      await runtime.close();
    }
  });

  it("windows a stream's snapshot to the newest messages and pages older ones (issue #92)", async () => {
    const runtime = await openTestRuntime({ storePath: ":memory:" });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      for (let i = 0; i < 4; i++) {
        await runtime.submit(ref, { requestId: `window-${i}`, text: `message ${i}` });
      }
      await waitUntil(
        async () => (await runtime.lastMessage(ref))?.text === "Echo: message 3",
        "every message to be answered",
      );
      const full = (await runtime.readChat(ref)).messages;
      expect(full).toHaveLength(8);

      const chat = await observeChat(runtime, ref, { window: 3 });
      expect(chat.batches[0][0]).toMatchObject({
        type: "snapshot",
        state: { hasMore: true, cursor: full[5].id, messages: full.slice(5) },
      });

      // New messages extend the window: nothing older is removed from it.
      await runtime.submit(ref, { requestId: "window-4", text: "message 4" });
      await waitUntil(
        () =>
          !chat.state().busy &&
          chat.state().messages.at(-1)?.text === "Echo: message 4" &&
          chat.state().messages.at(-1)?.status === "done",
        "the new reply to land",
      );
      expect(chat.batches.flat().some((event) => event.type === "remove")).toBe(false);
      expect(
        chat.batches
          .slice(1)
          .flat()
          .some((event) => event.type === "snapshot"),
      ).toBe(false);
      expect(chat.state().messages.map((m) => m.text)).toEqual([
        ...full.slice(5).map((m) => m.text),
        "message 4",
        "Echo: message 4",
      ]);
      await chat.stop();

      // History above the window, page by page.
      const page = await runtime.readChatPage(ref, { before: full[5].id, limit: 3 });
      expect(page).toEqual({ messages: full.slice(2, 5), hasMore: true });
      const last = await runtime.readChatPage(ref, { before: full[2].id, limit: 3 });
      expect(last).toEqual({ messages: full.slice(0, 2), hasMore: false });
      expect(await runtime.readChatPage(ref, { before: "e9999", limit: 3 })).toBeUndefined();

      // A short conversation fits its window whole.
      const other = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      const short = await observeChat(runtime, other, { window: 3 });
      expect(short.batches[0][0]).toMatchObject({
        type: "snapshot",
        state: { messages: [], hasMore: false },
      });
      await short.stop();
    } finally {
      await runtime.close();
    }
  });

  it("reports finished replies only once the conversation is idle", async () => {
    const runtime = await openTestRuntime({ storePath: ":memory:", tokensPerSecond: 5 });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      await runtime.submit(ref, { requestId: "finished-1", text: "slow one" });
      await waitUntil(() => runtime.isBusy(ref), "the reply to start");
      expect(await runtime.finishedReplies(ref)).toEqual([]);

      await waitUntil(() => !runtime.isBusy(ref), "the reply to finish");
      const replies = await runtime.finishedReplies(ref);
      expect(replies).toEqual([{ text: "Echo: slow one", createdAt: expect.any(Number) }]);
    } finally {
      await runtime.close();
    }
  });

  it("reports a model error as a finished reply carrying the error", async () => {
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      respondWith: () => ({
        ...fauxAssistantMessage([]),
        stopReason: "error" as const,
        errorMessage: "Provider unavailable",
      }),
    });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      await runtime.submit(ref, { requestId: "error-1", text: "hello" });
      await waitUntil(
        async () => (await runtime.finishedReplies(ref)).length > 0,
        "the failed reply to settle",
      );
      expect(await runtime.finishedReplies(ref)).toEqual([
        { text: "", createdAt: expect.any(Number), error: "Provider unavailable" },
      ]);
    } finally {
      await runtime.close();
    }
  });

  it("answers each queued submission with its own turn's reply, by request id", async () => {
    const runtime = await openTestRuntime({ storePath: ":memory:" });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      await runtime.submit(ref, { requestId: "turn-1", text: "one" });
      await runtime.submit(ref, { requestId: "turn-2", text: "two" });
      await waitUntil(
        async () => finishedReplyTo(await runtime.readChat(ref), "turn-2").status === "answered",
        "both turns to finish",
      );
      expect(finishedReplyTo(await runtime.readChat(ref), "turn-1")).toEqual({
        status: "answered",
        reply: { text: "Echo: one", createdAt: expect.any(Number) },
      });
      expect(finishedReplyTo(await runtime.readChat(ref), "turn-2")).toEqual({
        status: "answered",
        reply: { text: "Echo: two", createdAt: expect.any(Number) },
      });
      expect(finishedReplyTo(await runtime.readChat(ref), "never-sent")).toEqual({
        status: "unknown",
      });
    } finally {
      await runtime.close();
    }
  });

  it("carries the request id of an attachment send on its user message", async () => {
    const runtime = await openTestRuntime({ storePath: ":memory:" });
    try {
      const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
      const chat = await observeChat(runtime, ref);
      await runtime.submit(ref, {
        requestId: "with-file",
        text: "see this\n\n[file attached: notes.txt, text/plain, 1 KB]",
        attachments: [
          { uploadId: "u1", kind: "file", name: "notes.txt", mimeType: "text/plain", size: 900 },
        ],
      });
      await runtime.submit(ref, { requestId: "plain", text: "and this" });
      await waitUntil(
        () => chat.state().messages.filter((m) => m.role === "user").length === 2,
        "both sends to land",
      );
      const users = chat.state().messages.filter((m) => m.role === "user");
      expect(users[0]).toMatchObject({ requestId: "with-file" });
      // Plain sends record their request id too, so an Echo confirms by id.
      expect(users[1]).toMatchObject({ requestId: "plain" });
      await chat.stop();
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

  it("treats back-to-back inputs answered by one reply as answered", () => {
    const messages = deriveChat(
      rawChat([
        userEntry(1, "queued message"),
        userEntry(2, "steer message"),
        assistantEntry(3, "one reply for both"),
      ]),
    );

    expect(messages.map((message) => [message.id, message.status])).toEqual([
      ["e1", "done"],
      ["e2", "done"],
      ["e3", "done"],
    ]);
  });

  it("still flags a recorded settlement inside a run of inputs", () => {
    const messages = deriveChat(
      rawChat(
        [userEntry(1, "stopped early"), userEntry(2, "asked again"), assistantEntry(3, "answer")],
        { unanswered: new Map([[1, "aborted"]]) },
      ),
    );

    expect(messages[0]).toMatchObject({ id: "e1", status: "unanswered" });
    expect(messages[1]).toMatchObject({ id: "e2", status: "done" });
  });

  it("leaves trailing inputs alone while the bot is still working", () => {
    const state = chatState(
      rawChat([userEntry(1, "first"), userEntry(2, "second")], { busy: true }),
    );

    expect(state.messages.map((message) => message.status)).toEqual(["done", "done"]);
  });

  it("emits deltas for append-only text and upserts for a changed message", () => {
    const previous: ChatState = { messages: [assistantMessage("Hel")], busy: true, queued: [] };
    const appended: ChatState = { messages: [assistantMessage("Hello")], busy: true, queued: [] };
    const changed: ChatState = { messages: [assistantMessage("Howdy")], busy: true, queued: [] };

    expect(diffChat(previous, appended)).toEqual([{ type: "delta", id: "live", text: "lo" }]);
    expect(diffChat(previous, changed)).toEqual([
      { type: "upsert", message: assistantMessage("Howdy") },
    ]);
  });

  it("windows a derived chat without losing the flags at its edge", () => {
    const state = chatState(
      rawChat(
        [
          userEntry(1, "first"),
          assistantEntry(2, "answer"),
          userEntry(3, "never answered"),
          userEntry(4, "asked again"),
          assistantEntry(5, "second answer"),
          userEntry(6, "latest"),
        ],
        {
          busy: true,
          live: assistantEntry(7, "stream").model?.[0] as AssistantMessage,
          unanswered: new Map([[3, "aborted"]]),
        },
      ),
    );
    const windowed = windowChat(state, 5);
    // e3 is unanswered because the runtime recorded it so, and e6 is not
    // because the live reply answers it: both judged over the full transcript.
    expect(windowed?.messages.map((m) => [m.id, m.status])).toEqual([
      ["e3", "unanswered"],
      ["e4", "done"],
      ["e5", "done"],
      ["e6", "done"],
      ["live", "streaming"],
    ]);
    expect(windowed).toMatchObject({ hasMore: true, cursor: "e3", busy: true });

    // A window that holds everything has nothing more above it.
    expect(windowChat(state, 50)).toMatchObject({ hasMore: false, cursor: "e1" });
    // Anchored at an id, the window keeps every message from it on.
    expect(windowChat(state, 2, "e4")?.messages.map((m) => m.id)).toEqual([
      "e4",
      "e5",
      "e6",
      "live",
    ]);
    expect(windowChat(state, 2, "e99")).toBeUndefined();
    // An empty chat: no cursor.
    expect(windowChat(chatState(rawChat([])), 4)).toEqual({
      messages: [],
      busy: false,
      queued: [],
      hasMore: false,
    });
  });

  it("pages the messages before a cursor", () => {
    const { messages } = chatState(rawChat([1, 2, 3, 4, 5].map((n) => userEntry(n * 2, `m${n}`))));
    const ids = (page: ReturnType<typeof pageBefore>) => page?.messages.map((m) => m.id);
    expect(ids(pageBefore(messages, "e10", 2))).toEqual(["e6", "e8"]);
    expect(pageBefore(messages, "e10", 2)?.hasMore).toBe(true);
    expect(ids(pageBefore(messages, "e6", 2))).toEqual(["e2", "e4"]);
    expect(pageBefore(messages, "e6", 2)?.hasMore).toBe(false);
    expect(pageBefore(messages, "e2", 5)).toEqual({ messages: [], hasMore: false });
    expect(pageBefore(messages, "e3", 5)).toBeUndefined();
  });

  it("emits a queued event only when the queue changes", () => {
    const item = { requestId: "q1", mode: "steer" as const, text: "wait up" };
    const idle: ChatState = { messages: [], busy: true, queued: [] };
    const holding: ChatState = { messages: [], busy: true, queued: [item] };

    expect(diffChat(idle, holding)).toEqual([{ type: "queued", items: [item] }]);
    expect(diffChat(holding, holding)).toEqual([]);
    expect(diffChat(holding, idle)).toEqual([{ type: "queued", items: [] }]);
  });

  it("derives queued owner messages, hiding peer deliveries and writes", () => {
    const record = (id: string, requestId: string) =>
      ({
        id,
        conversationId: 1,
        requestId,
        type: "input",
        status: "queued",
      }) as unknown as SubmissionRecord;
    const records = new Map([
      ["1", record("1", "owner-send")],
      ["2", record("2", "mention-send")],
      ["4", record("4", "with-attachment")],
    ]);
    const items = [
      // A plain owner steer.
      { id: "1", mode: "steer", content: "wait up" },
      // A mention delivered cross-bot: not the owner's message.
      {
        id: "2",
        mode: "followUp",
        content: "tagged from elsewhere",
        entry: { kind: CHAT_USER_ENTRY, data: { peer: { kind: "mention", hostName: "Host" } } },
      },
      // A write submission (a compaction summary): not a chat message.
      { id: "3", mode: "write", entry: { kind: "app.note", data: {} } },
      // An owner send with attachments, content split into blocks.
      {
        id: "4",
        mode: "followUp",
        content: [{ type: "text", text: "see this" }],
        entry: {
          kind: CHAT_USER_ENTRY,
          data: {
            attachments: [
              {
                uploadId: "zzz",
                kind: "image",
                name: "shot.png",
                mimeType: "image/png",
                size: 10,
              },
            ],
          },
        },
      },
    ] as unknown as readonly InboxItem[];

    expect(queuedOf(items, records)).toEqual([
      { requestId: "owner-send", mode: "steer", text: "wait up" },
      {
        requestId: "with-attachment",
        mode: "followUp",
        text: "see this",
        attachments: [
          { uploadId: "zzz", kind: "image", name: "shot.png", mimeType: "image/png", size: 10 },
        ],
      },
    ]);
  });
});
