import { describe, expect, it } from "vite-plus/test";
import {
  chatView,
  newChatSession,
  reduceChat,
  type ChatAction,
  type ChatSession,
  type Echo,
} from "../../../apps/web/src/client/lib/chat-session";
import type {
  AttachmentRef,
  ChatMessage,
  QueuedMessage,
  RoutineRunCard,
} from "../../../apps/web/src/client/lib/chat-types";

const play = (...actions: ChatAction[]): ChatSession =>
  actions.reduce(reduceChat, newChatSession());
const then = (session: ChatSession, ...actions: ChatAction[]): ChatSession =>
  actions.reduce(reduceChat, session);

const user = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: "user",
  text,
  status: "done",
  createdAt: 1,
  ...extra,
});
const reply = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: "assistant",
  text,
  status: "done",
  createdAt: 2,
  ...extra,
});

const snapshot = (
  messages: ChatMessage[],
  extra: { busy?: boolean; queued?: QueuedMessage[]; hasMore?: boolean } = {},
): ChatAction => ({
  type: "snapshot",
  state: {
    messages,
    busy: extra.busy ?? false,
    queued: extra.queued ?? [],
    hasMore: extra.hasMore,
  },
});

const echo = (requestId: string, text: string, extra: Partial<Echo> = {}): ChatAction => ({
  type: "echo",
  echo: { requestId, text, createdAt: 1, offline: false, ...extra },
});

const outbox = (session: ChatSession) =>
  chatView(session).outbox.map((entry) => `${entry.requestId}:${entry.state}`);

const file = (uploadId: string): AttachmentRef[] => [
  { uploadId, kind: "file", name: "notes.txt", mimeType: "text/plain", size: 5 },
];

describe("chat session: Echoes (GLOSSARY: Echo)", () => {
  it("shows an Echo at the end of the timeline until its confirmation arrives", () => {
    const sent = play(snapshot([]), echo("req-1", "hello there"));
    const view = chatView(sent);
    expect(outbox(sent)).toEqual(["req-1:sending"]);
    expect(view.timeline.map((item) => item.kind)).toEqual(["echo"]);
    expect(view.messages).toEqual([]);

    const confirmed = then(sent, {
      type: "upsert",
      message: user("e1", "hello there", { requestId: "req-1", createdAt: 2 }),
    });
    expect(outbox(confirmed)).toEqual([]);
    expect(chatView(confirmed).timeline.map((item) => item.kind)).toEqual(["message"]);
  });

  it("drops the Echoes a fresh snapshot confirms and keeps the ones still in flight", () => {
    const session = play(
      snapshot([]),
      echo("a", "sent and confirmed"),
      echo("b", "still flying", { createdAt: 2 }),
      snapshot([user("e1", "sent and confirmed", { requestId: "a", createdAt: 3 })], {
        busy: true,
      }),
    );
    expect(outbox(session)).toEqual(["b:sending"]);
    expect(session.messages.map((m) => m.id)).toEqual(["e1"]);
  });

  it("marks an Echo offline while it waits for the browser, and withdraws a refused one", () => {
    const waiting = play(snapshot([]), echo("x", "later"), {
      type: "echo-offline",
      requestId: "x",
    });
    expect(outbox(waiting)).toEqual(["x:offline"]);
    expect(chatView(waiting).timeline.map((item) => item.kind)).toEqual(["echo"]);
    expect(outbox(then(waiting, { type: "echo-retry", requestId: "x" }))).toEqual(["x:sending"]);
    expect(outbox(then(waiting, { type: "echo-refused", requestId: "x" }))).toEqual([]);
  });

  it("confirms by request id: a repeated text does not clear a newer Echo", () => {
    const earlier = user("e1", "ok", { requestId: "req-old", createdAt: 1_000 });
    const session = play(
      snapshot([earlier]),
      echo("req-new", "ok", { createdAt: 60_000 }),
      snapshot([earlier]),
    );
    expect(outbox(session)).toEqual(["req-new:sending"]);
    const confirmed = then(session, {
      type: "upsert",
      message: { ...earlier, id: "e2", requestId: "req-new", createdAt: 60_100 },
    });
    expect(outbox(confirmed)).toEqual([]);
  });

  it("never confirms an Echo with a message that has no request id", () => {
    const session = play(snapshot([]), echo("req-new", "ok", { createdAt: 60_000 }));
    const sameText = user("e2", "ok", { createdAt: 61_000 });
    expect(outbox(then(session, snapshot([sameText])))).toEqual(["req-new:sending"]);
    expect(outbox(then(session, { type: "upsert", message: sameText }))).toEqual([
      "req-new:sending",
    ]);
  });

  it("confirms a file send by request id although the server annotated its text", () => {
    const session = play(snapshot([]), echo("echo-d", "see this", { attachments: file("fff") }), {
      type: "upsert",
      message: user("e3", "see this\n\n[file attached: notes.txt, text/plain, 0 KB]", {
        requestId: "echo-d",
        attachments: file("fff"),
      }),
    });
    expect(outbox(session)).toEqual([]);
  });

  it("a recorded request id only confirms its own Echo", () => {
    const session = play(snapshot([]), echo("echo-e", "again", { attachments: file("ggg") }), {
      type: "upsert",
      message: user("e4", "again", { requestId: "some-other-send", attachments: file("ggg") }),
    });
    expect(outbox(session)).toEqual(["echo-e:sending"]);
  });
});

describe("chat session: held messages (issue #9)", () => {
  it("replaces an Echo with the server's held item, steering or queued", () => {
    const session = play(snapshot([], { busy: true }), echo("req-1", "wait up"), {
      type: "queued",
      items: [{ requestId: "req-1", mode: "steer", text: "wait up" }],
    });
    expect(outbox(session)).toEqual(["req-1:steering"]);
    expect(chatView(session).timeline).toEqual([]);
    const later = then(session, {
      type: "queued",
      items: [{ requestId: "req-1", mode: "followUp", text: "wait up" }],
    });
    expect(chatView(later).outbox).toEqual([
      { requestId: "req-1", text: "wait up", state: "queued" },
    ]);
  });

  it("keeps held items through reconnect snapshots and clears them when placed", () => {
    const messages = [user("m1", "first"), reply("m2", "working", { status: "streaming" })];
    const held: QueuedMessage = { requestId: "req-9", mode: "followUp", text: "then this" };
    const session = play(
      snapshot(messages, { busy: true, queued: [held] }),
      echo("req-9", "then this", { createdAt: 3 }),
      snapshot(messages, { busy: true, queued: [held] }),
    );
    expect(outbox(session)).toEqual(["req-9:queued"]);

    const placed = then(
      session,
      { type: "upsert", message: user("e5", "then this", { createdAt: 4 }) },
      { type: "queued", items: [] },
    );
    expect(outbox(placed)).toEqual([]);
    expect(placed.messages.some((m) => m.id === "e5")).toBe(true);
  });
});

describe("chat session: stream", () => {
  const card = (id: string): RoutineRunCard => ({
    id,
    routineId: "r",
    routineName: "digest",
    status: "succeeded",
    trigger: "schedule",
    scheduledFor: "2026-10-20T03:30:00.000Z",
    finishedAt: "2026-10-20T03:31:00.000Z",
    output: "ok",
    error: null,
  });

  it("is loading until the first snapshot, live after, reconnecting while the stream is down", () => {
    const opening = play({ type: "opened" }, { type: "stream-open" });
    expect(chatView(opening).health).toBe("loading");
    const live = then(opening, snapshot([]));
    expect(chatView(live).health).toBe("live");
    expect(chatView(then(live, { type: "error", message: "SSE 502" })).health).toBe("reconnecting");
    expect(chatView(then(live, { type: "stream-drop" })).health).toBe("reconnecting");
    const left = then(live, { type: "upsert", message: user("e1", "hi") }, { type: "closed" });
    expect(chatView(left).health).toBe("loading");
    expect(left.messages).toHaveLength(1);
  });

  it("keeps routine cards and YOLO mode across transcript snapshots, each run once", () => {
    const session = play(
      snapshot([]),
      { type: "routine-runs", runs: [card("a")] },
      { type: "yolo", on: true },
      snapshot([]),
      { type: "routine-run", run: card("a") },
      { type: "routine-run", run: card("b") },
    );
    expect(session.routineRuns.map((run) => run.id)).toEqual(["a", "b"]);
    expect(session.messages).toEqual([]);
    expect(chatView(session).yolo).toBe(true);
  });

  it("streams a reply's text and reasoning in by deltas", () => {
    const session = play(
      snapshot([reply("live", "Hel", { status: "streaming" })]),
      { type: "delta", id: "live", text: "lo", reasoning: "thinking" },
      { type: "ping" },
    );
    expect(session.messages[0]).toMatchObject({ text: "Hello", reasoning: "thinking" });
  });

  it("keeps older pages above a reconnect's window, and drops a page that no longer fits", () => {
    const window = [user("e10", "ten"), reply("e11", "eleven")];
    const opened = play(snapshot(window, { hasMore: true }), { type: "older-loading" });
    const paged = then(opened, {
      type: "older-page",
      before: "e10",
      page: { messages: [user("e8", "eight"), reply("e9", "nine")], hasMore: false },
    });
    expect(paged.messages.map((m) => m.id)).toEqual(["e8", "e9", "e10", "e11"]);
    expect(chatView(paged)).toMatchObject({ hasMore: false, loadingOlder: false });
    const reconnected = then(paged, snapshot(window, { hasMore: true }));
    expect(reconnected.messages.map((m) => m.id)).toEqual(["e8", "e9", "e10", "e11"]);

    const stale = then(opened, snapshot([user("e20", "new")]), {
      type: "older-page",
      before: "e10",
      page: { messages: [user("e8", "eight")], hasMore: false },
    });
    expect(stale.messages.map((m) => m.id)).toEqual(["e20"]);
    expect(stale.loadingOlder).toBe(false);
  });
});

describe("chat view: unread divider and typing (issues #3, #2)", () => {
  const visit = (unreadFrom: number | null, ...actions: ChatAction[]) =>
    actions.reduce(reduceChat, reduceChat(newChatSession(unreadFrom), { type: "opened" }));
  const transcript = [
    user("u1", "read question", { createdAt: 1_000 }),
    reply("a1", "read answer", { createdAt: 2_000 }),
    reply("a2", "unread reply", { createdAt: 3_000 }),
  ];

  it("puts the divider above the first reply newer than the read marker", () => {
    const view = chatView(visit(1_500, snapshot(transcript)));
    expect(view.unreadDividerId).toBe("a1");
    expect([0, 1, 2].map(view.isRead)).toEqual([true, false, false]);
    expect(chatView(visit(4_000, snapshot(transcript))).unreadDividerId).toBeNull();
  });

  it("does not flag the owner's own message or a reply that arrives while the chat is open", () => {
    const open = visit(1_500, snapshot([user("u1", "old", { createdAt: 1_000 })]));
    const live = then(
      open,
      { type: "upsert", message: user("u2", "new", { createdAt: 5_000 }) },
      { type: "upsert", message: reply("a2", "live", { createdAt: 6_000 }) },
      snapshot([user("u1", "old"), user("u2", "new"), reply("a2", "live", { createdAt: 6_000 })]),
    );
    expect(chatView(live).unreadDividerId).toBeNull();
  });

  it("shows typing dots while the bot works with nothing on screen to show it", () => {
    const asked = snapshot([user("u1", "hi")], { busy: true });
    expect(chatView(play(asked)).typing).toBe(true);
    const streaming = reply("a1", "Hel", { status: "streaming" });
    expect(chatView(play(asked, { type: "upsert", message: streaming })).typing).toBe(false);
    const tool = reply("a1", "", {
      toolCalls: [{ id: "t", name: "web_search", args: {}, status: "running" }],
    });
    expect(chatView(play(asked, { type: "upsert", message: tool })).typing).toBe(false);
    const round = reply("a1", "", {
      toolCalls: [{ id: "t", name: "web_search", args: {}, status: "done" }],
    });
    expect(chatView(play(asked, { type: "upsert", message: round })).typing).toBe(true);
    expect(chatView(play(asked, echo("r", "more"))).typing).toBe(false);
    expect(chatView(play(snapshot([user("u1", "hi")]))).typing).toBe(false);
  });
});
