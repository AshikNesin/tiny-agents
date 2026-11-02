/**
 * Store behavior for optimistic sends and stream-health state — the fixes
 * for "sent message not showing in UI" (echo before server confirm, SSE
 * reconnect instead of give-up, visible Reconnecting banner).
 */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const listeners = new Map<string, (event: unknown) => void>();
const openCallbacks: Array<() => void> = [];

vi.mock("../../../apps/web/src/client/lib/bots-api", () => ({
  botsApi: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    read: vi.fn().mockResolvedValue(undefined),
    models: vi
      .fn()
      .mockResolvedValue({ models: [], defaultModel: undefined, gatewayConfigured: true }),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../apps/web/src/client/lib/sse", () => ({
  subscribeSse: vi.fn(
    (path: string, onEvent: (e: unknown) => void, opts: { onOpen?: () => void } = {}) => {
      listeners.set(path, onEvent);
      if (opts.onOpen) openCallbacks.push(opts.onOpen);
      return { close: () => undefined };
    },
  ),
}));

import { onConnectionChange, useBotsStore } from "../../../apps/web/src/client/store/bots";
import { botsApi, type Bot, type BotListEntry } from "../../../apps/web/src/client/lib/bots-api";

const emit = (botId: string, event: unknown) =>
  useBotsStore.getState().applyChatEvent(botId, event as never);

describe("bots store — optimistic send", () => {
  beforeEach(() => {
    listeners.clear();
    openCallbacks.length = 0;
    useBotsStore.setState({ chats: {} });
  });

  it("keeps a pending echo until the confirmed user message arrives, then replaces it", () => {
    const botId = "bot-1";
    useBotsStore.getState().connectChat(botId);

    emit(botId, { type: "snapshot", state: { messages: [], busy: false } });
    emit(botId, {
      type: "pending-add",
      message: { id: "echo-1", text: "hello there", createdAt: 1 },
    });

    let chat = useBotsStore.getState().chats[botId]!;
    expect(chat.pending).toHaveLength(1);
    expect(chat.pending[0].text).toBe("hello there");
    expect(chat.messages).toHaveLength(0);

    // Server confirms: upsert arrives for the real user message.
    emit(botId, {
      type: "upsert",
      message: { id: "real-1", role: "user", text: "hello there", status: "done", createdAt: 2 },
    });

    chat = useBotsStore.getState().chats[botId]!;
    expect(chat.pending).toHaveLength(0);
    expect(chat.messages.map((m) => m.id)).toEqual(["real-1"]);
  });

  it("drops pending echoes confirmed by a fresh snapshot, keeps unconfirmed ones", () => {
    const botId = "bot-2";
    useBotsStore.getState().connectChat(botId);

    emit(botId, { type: "snapshot", state: { messages: [], busy: false } });
    emit(botId, {
      type: "pending-add",
      message: { id: "a", text: "sent+confirmed", createdAt: 1 },
    });
    emit(botId, { type: "pending-add", message: { id: "b", text: "still flying", createdAt: 2 } });

    emit(botId, {
      type: "snapshot",
      state: {
        messages: [
          { id: "r1", role: "user", text: "sent+confirmed", status: "done", createdAt: 3 },
        ],
        busy: true,
      },
    });

    const chat = useBotsStore.getState().chats[botId]!;
    expect(chat.pending.map((p) => p.id)).toEqual(["b"]);
    expect(chat.messages.map((m) => m.id)).toEqual(["r1"]);
  });

  it("withdraws the echo on send failure via pending-remove", () => {
    const botId = "bot-3";
    emit(botId, { type: "pending-add", message: { id: "x", text: "nope", createdAt: 1 } });
    emit(botId, { type: "pending-remove", id: "x" });
    expect(useBotsStore.getState().chats[botId]!.pending).toHaveLength(0);
  });

  it("a repeated text does not clear a newer Echo: confirmation is by request id", () => {
    const botId = "bot-repeat";
    useBotsStore.getState().connectChat(botId);
    const earlier = {
      id: "e1",
      role: "user",
      text: "ok",
      requestId: "req-old",
      status: "done",
      createdAt: 1_000,
    };
    emit(botId, { type: "snapshot", state: { messages: [earlier], busy: false } });
    emit(botId, {
      type: "pending-add",
      message: { id: "req-new", text: "ok", createdAt: 60_000 },
    });

    // A reconnect snapshot still holding only the earlier "ok" keeps the new Echo.
    emit(botId, { type: "snapshot", state: { messages: [earlier], busy: false } });
    expect(useBotsStore.getState().chats[botId]!.pending.map((p) => p.id)).toEqual(["req-new"]);

    // Its own confirmation clears it.
    emit(botId, {
      type: "upsert",
      message: { ...earlier, id: "e2", requestId: "req-new", createdAt: 60_100 },
    });
    expect(useBotsStore.getState().chats[botId]!.pending).toHaveLength(0);
  });

  it("an earlier legacy message (no request id) with the same text does not clear a newer Echo", () => {
    const botId = "bot-legacy";
    useBotsStore.getState().connectChat(botId);
    const legacy = { id: "e1", role: "user", text: "ok", status: "done", createdAt: 1_000 };
    emit(botId, { type: "snapshot", state: { messages: [legacy], busy: false } });
    emit(botId, {
      type: "pending-add",
      message: { id: "req-new", text: "ok", createdAt: 60_000 },
    });
    emit(botId, { type: "snapshot", state: { messages: [legacy], busy: false } });
    expect(useBotsStore.getState().chats[botId]!.pending.map((p) => p.id)).toEqual(["req-new"]);
  });
});

describe("bots store — routine run cards (issue #63)", () => {
  beforeEach(() => {
    useBotsStore.setState({ chats: {} });
  });

  const card = (id: string) => ({
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

  it("keeps cards across transcript snapshots and adds each finished run once", () => {
    const botId = "bot-cards";
    useBotsStore.getState().connectChat(botId);
    emit(botId, { type: "snapshot", state: { messages: [], busy: false } });
    emit(botId, { type: "routine-runs", runs: [card("a")] });
    // A reconnect's transcript snapshot does not drop the cards.
    emit(botId, { type: "snapshot", state: { messages: [], busy: false } });
    // Listed and followed at connect: the same run can arrive again.
    emit(botId, { type: "routine-run", run: card("a") });
    emit(botId, { type: "routine-run", run: card("b") });
    expect(useBotsStore.getState().chats[botId]!.routineRuns.map((run) => run.id)).toEqual([
      "a",
      "b",
    ]);
    // The bot's transcript is untouched: cards are not messages.
    expect(useBotsStore.getState().chats[botId]!.messages).toEqual([]);
  });
});

describe("bots store — stream health", () => {
  beforeEach(() => {
    listeners.clear();
    openCallbacks.length = 0;
    useBotsStore.setState({ chats: {} });
  });

  it("marks the chat connected on stream open and snapshot, disconnected on stream error", () => {
    const botId = "bot-4";
    useBotsStore.getState().connectChat(botId);

    // connectChat wires onOpen; simulate the stream opening.
    for (const open of openCallbacks.splice(0)) open();
    expect(useBotsStore.getState().chats[botId]!.connected).toBe(true);

    emit(botId, { type: "snapshot", state: { messages: [], busy: false } });
    expect(useBotsStore.getState().chats[botId]!.connected).toBe(true);

    // The reducer handles {type:error} by clearing connected.
    const path = `/api/v1/bots/${botId}/stream`;
    listeners.get(path)?.({ type: "error", message: "SSE 502" });
    expect(useBotsStore.getState().chats[botId]!.connected).toBe(false);
  });
});

describe("bots store — new chat (reset)", () => {
  beforeEach(() => {
    listeners.clear();
    openCallbacks.length = 0;
    useBotsStore.setState({ chats: {} });
  });

  it("resetChat drops the cached transcript so the next connectChat starts fresh", () => {
    const botId = "bot-5";
    useBotsStore.getState().connectChat(botId);
    emit(botId, {
      type: "snapshot",
      state: {
        messages: [
          { id: "m1", role: "user", text: "old conversation", status: "done", createdAt: 1 },
        ],
        busy: false,
      },
    });
    expect(useBotsStore.getState().chats[botId]!.messages).toHaveLength(1);

    // New chat: the server moved the bot to a fresh conversation and the
    // component closed the stream and dropped the cached ChatState.
    useBotsStore.getState().resetChat(botId);
    expect(useBotsStore.getState().chats[botId]).toBeUndefined();

    // Reopening the chat starts from scratch (no stale messages, no busy),
    // and the first snapshot of the new conversation is the empty transcript.
    useBotsStore.getState().connectChat(botId);
    emit(botId, { type: "snapshot", state: { messages: [], busy: false } });
    const chat = useBotsStore.getState().chats[botId]!;
    expect(chat.messages).toHaveLength(0);
    expect(chat.busy).toBe(false);
  });
});

describe("bots store — attachment echoes (issue #17)", () => {
  beforeEach(() => {
    listeners.clear();
    openCallbacks.length = 0;
    useBotsStore.setState({ chats: {} });
  });

  it("two image-only sends (empty text) do not dedupe each other", () => {
    const botId = "bot-img";
    useBotsStore.getState().connectChat(botId);
    emit(botId, { type: "snapshot", state: { messages: [], busy: false } });

    const attachment = (uploadId: string) => [
      { uploadId, kind: "image", name: "shot.png", mimeType: "image/png", size: 10 },
    ];
    emit(botId, {
      type: "pending-add",
      message: { id: "echo-a", text: "", createdAt: 1, attachments: attachment("aaa") },
    });
    emit(botId, {
      type: "pending-add",
      message: { id: "echo-b", text: "", createdAt: 2, attachments: attachment("bbb") },
    });
    expect(useBotsStore.getState().chats[botId]!.pending).toHaveLength(2);

    // First send confirms: only its echo (matching attachment id) clears.
    emit(botId, {
      type: "upsert",
      message: {
        id: "e1",
        role: "user",
        text: "",
        status: "done",
        createdAt: 1,
        attachments: attachment("aaa"),
      },
    });
    const chat = useBotsStore.getState().chats[botId]!;
    expect(chat.pending).toHaveLength(1);
    expect(chat.pending[0].id).toBe("echo-b");
  });

  it("clears an echo when a snapshot carries the same text and attachments", () => {
    const botId = "bot-img2";
    useBotsStore.getState().connectChat(botId);
    emit(botId, { type: "snapshot", state: { messages: [], busy: false } });
    const attachments = [
      { uploadId: "zzz", kind: "file", name: "notes.txt", mimeType: "text/plain", size: 5 },
    ];
    emit(botId, {
      type: "pending-add",
      message: { id: "echo-c", text: "see this", createdAt: 1, attachments },
    });
    emit(botId, {
      type: "snapshot",
      state: {
        messages: [
          {
            id: "e2",
            role: "user",
            text: "see this",
            status: "done",
            createdAt: 1,
            attachments,
          },
        ],
        busy: true,
      },
    });
    expect(useBotsStore.getState().chats[botId]!.pending).toHaveLength(0);
  });

  it("clears a file send's echo by request id although the server annotated its text", () => {
    const botId = "bot-file";
    useBotsStore.getState().connectChat(botId);
    emit(botId, { type: "snapshot", state: { messages: [], busy: false } });
    const attachments = [
      { uploadId: "fff", kind: "file", name: "notes.txt", mimeType: "text/plain", size: 5 },
    ];
    emit(botId, {
      type: "pending-add",
      message: { id: "echo-d", text: "see this", createdAt: 1, attachments },
    });
    // resolveSend appends a metadata line for every file: the text differs.
    emit(botId, {
      type: "upsert",
      message: {
        id: "e3",
        role: "user",
        text: "see this\n\n[file attached: notes.txt, text/plain, 0 KB]",
        requestId: "echo-d",
        status: "done",
        createdAt: 1,
        attachments,
      },
    });
    expect(useBotsStore.getState().chats[botId]!.pending).toHaveLength(0);
  });

  it("a recorded request id only confirms its own echo", () => {
    const botId = "bot-same-text";
    useBotsStore.getState().connectChat(botId);
    emit(botId, { type: "snapshot", state: { messages: [], busy: false } });
    const attachments = [
      { uploadId: "ggg", kind: "file", name: "a.txt", mimeType: "text/plain", size: 5 },
    ];
    emit(botId, {
      type: "pending-add",
      message: { id: "echo-e", text: "again", createdAt: 1, attachments },
    });
    emit(botId, {
      type: "upsert",
      message: {
        id: "e4",
        role: "user",
        text: "again",
        requestId: "some-other-send",
        status: "done",
        createdAt: 1,
        attachments,
      },
    });
    expect(useBotsStore.getState().chats[botId]!.pending.map((p) => p.id)).toEqual(["echo-e"]);
  });
});

describe("bots store — queued messages while busy (issue #9)", () => {
  beforeEach(() => {
    listeners.clear();
    openCallbacks.length = 0;
    useBotsStore.setState({ chats: {} });
  });

  it("replaces the optimistic echo with the server's queued item", () => {
    const botId = "bot-q1";
    useBotsStore.getState().connectChat(botId);
    emit(botId, { type: "snapshot", state: { messages: [], busy: true, queued: [] } });
    emit(botId, {
      type: "pending-add",
      message: { id: "req-1", text: "wait up", createdAt: 1 },
    });
    expect(useBotsStore.getState().chats[botId]!.pending).toHaveLength(1);

    // Server confirms: the message is held — a steer joins the running reply.
    emit(botId, {
      type: "queued",
      items: [{ requestId: "req-1", mode: "steer", text: "wait up" }],
    });
    const chat = useBotsStore.getState().chats[botId]!;
    expect(chat.pending).toHaveLength(0);
    expect(chat.queued).toEqual([{ requestId: "req-1", mode: "steer", text: "wait up" }]);
  });

  it("keeps queued items through reconnect snapshots and clears them when placed", () => {
    const botId = "bot-q2";
    useBotsStore.getState().connectChat(botId);
    const messages = [
      { id: "m1", role: "user", text: "first", status: "done", createdAt: 1 },
      { id: "m2", role: "assistant", text: "working", status: "streaming", createdAt: 2 },
    ];
    const held = { requestId: "req-9", mode: "followUp", text: "then this" };
    emit(botId, { type: "snapshot", state: { messages, busy: true, queued: [held] } });

    // A reconnect (SSE drop, page reload) re-snapshots the held message: the
    // optimistic echo of the same send is superseded by the queued item.
    emit(botId, {
      type: "pending-add",
      message: { id: "req-9", text: "then this", createdAt: 3 },
    });
    emit(botId, { type: "snapshot", state: { messages, busy: true, queued: [held] } });
    expect(useBotsStore.getState().chats[botId]!.pending).toHaveLength(0);
    expect(useBotsStore.getState().chats[botId]!.queued).toEqual([held]);

    // Placement: the real user message lands and the queue empties.
    emit(botId, {
      type: "upsert",
      message: { id: "e5", role: "user", text: "then this", status: "done", createdAt: 4 },
    });
    emit(botId, { type: "queued", items: [] });
    const chat = useBotsStore.getState().chats[botId]!;
    expect(chat.queued).toEqual([]);
    expect(chat.messages.some((message) => message.id === "e5")).toBe(true);
  });
});

function listEntry(id: string, conversationId: string, overrides: Partial<BotListEntry> = {}) {
  return {
    id,
    conversationId,
    name: `Bot ${id}`,
    description: "",
    modelId: "m",
    lastMessagePreview: null,
    lastActivityAt: "2026-10-23T00:00:00.000Z",
    lastReadAt: null,
    unread: false,
    replying: false,
    approvals: 0,
    questions: 0,
    pinnedAt: null,
    ...overrides,
  } satisfies BotListEntry;
}

/** A list request the test answers when it wants to. */
function deferredList() {
  let resolve!: (bots: BotListEntry[]) => void;
  const promise = new Promise<BotListEntry[]>((r) => {
    resolve = r;
  });
  vi.mocked(botsApi.list).mockReturnValueOnce(promise);
  return resolve;
}

describe("bots store — activity feed", () => {
  beforeEach(() => {
    listeners.clear();
    useBotsStore.getState().disconnectActivity();
    vi.mocked(botsApi.list).mockReset();
    vi.mocked(botsApi.list).mockResolvedValue([]);
    useBotsStore.setState({ bots: [listEntry("b1", "7")], loading: false });
  });

  const feed = () => {
    useBotsStore.getState().connectActivity();
    return listeners.get("/api/v1/events")!;
  };

  it("updates the approvals and questions badge while the bot is still replying", () => {
    const onEvent = feed();
    onEvent({ type: "activity", conversation: "7", busy: true, approvals: 0 });
    // A tool call now waits for the owner: same busy run, new count.
    onEvent({ type: "activity", conversation: "7", busy: true, approvals: 1 });
    expect(useBotsStore.getState().bots[0]).toMatchObject({ replying: true, approvals: 1 });
    // The bot asks the owner questions: same run, its own count.
    onEvent({ type: "activity", conversation: "7", busy: true, approvals: 0, questions: 2 });
    expect(useBotsStore.getState().bots[0]).toMatchObject({ approvals: 0, questions: 2 });
  });

  it("keeps a waiting badge that arrived while an older list request was in flight", async () => {
    const onEvent = feed();
    // A list request starts (another bot went idle)…
    const answer = deferredList();
    const load = useBotsStore.getState().loadBots();
    // …then this bot asks for an approval, mid-run.
    onEvent({ type: "activity", conversation: "7", busy: true, approvals: 1 });
    expect(useBotsStore.getState().bots[0]).toMatchObject({ replying: true, approvals: 1 });
    // The stale list lands last: it knows nothing of the approval.
    answer([listEntry("b1", "7", { lastMessagePreview: "newer preview" })]);
    await load;
    expect(useBotsStore.getState().bots[0]).toMatchObject({
      replying: true,
      approvals: 1,
      lastMessagePreview: "newer preview",
    });
    // A list request that starts after the badge retires the patch: the
    // server's answer is the truth from then on.
    vi.mocked(botsApi.list).mockResolvedValueOnce([listEntry("b1", "7")]);
    await useBotsStore.getState().loadBots();
    expect(useBotsStore.getState().bots[0]).toMatchObject({ replying: false, approvals: 0 });
  });

  it("keeps a pin and a read mark made while a list request was in flight", async () => {
    const answer = deferredList();
    const load = useBotsStore.getState().loadBots();
    useBotsStore.setState({ bots: [listEntry("b1", "7", { unread: true })] });
    useBotsStore.getState().markRead("b1");
    answer([listEntry("b1", "7", { unread: true })]);
    await load;
    expect(useBotsStore.getState().bots[0]!.unread).toBe(false);
  });

  it("refetches once after a reply ends, and not for a conversation that is nobody's chat", async () => {
    vi.useFakeTimers();
    try {
      const onEvent = feed();
      onEvent({ type: "activity", conversation: "7", busy: true });
      expect(useBotsStore.getState().bots[0]!.replying).toBe(true);
      // A routine's conversation and a retired chat: no row, no list request.
      onEvent({ type: "activity", conversation: "42", busy: false });
      await vi.advanceTimersByTimeAsync(1000);
      expect(botsApi.list).not.toHaveBeenCalled();
      // The chat's reply ends: replying clears at once; preview and unread
      // come from one list request, however many idles land together.
      onEvent({ type: "activity", conversation: "7", busy: false });
      onEvent({ type: "activity", conversation: "7", busy: false });
      expect(useBotsStore.getState().bots[0]!.replying).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(botsApi.list).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks who is replying from the feed's opening snapshot", () => {
    useBotsStore.setState({ bots: [listEntry("b1", "7"), listEntry("b2", "8")] });
    const onEvent = feed();
    onEvent({ type: "activity", busy: ["8"] });
    expect(useBotsStore.getState().bots.map((bot) => bot.replying)).toEqual([false, true]);
  });

  it("keeps MCP connection status from the same feed and tells subscribers", () => {
    const onEvent = feed();
    const seen: unknown[] = [];
    const off = onConnectionChange((change) => seen.push(change));
    onEvent({ type: "connection", id: "c1", status: "connected" });
    onEvent({ type: "connection", id: "c2", status: "error", error: "refused" });
    expect(useBotsStore.getState().connections).toEqual({
      c1: { status: "connected" },
      c2: { status: "error", error: "refused" },
    });
    expect(seen).toHaveLength(2);
    off();
    onEvent({ type: "connection", id: "c1", status: "connecting" });
    expect(seen).toHaveLength(2);
  });
});

describe("bots store — full bots", () => {
  beforeEach(() => {
    useBotsStore.setState({ fullBots: {}, bots: [listEntry("b1", "7")] });
    vi.mocked(botsApi.get).mockReset();
  });

  it("loads a full bot once and serves it from the cache until asked for a fresh one", async () => {
    const row = { id: "b1", name: "Bot", conversationId: "7" } as unknown as Bot;
    vi.mocked(botsApi.get).mockResolvedValue(row);
    expect(await useBotsStore.getState().loadBot("b1")).toBe(row);
    expect(await useBotsStore.getState().loadBot("b1")).toBe(row);
    expect(botsApi.get).toHaveBeenCalledTimes(1);
    await useBotsStore.getState().loadBot("b1", { fresh: true });
    expect(botsApi.get).toHaveBeenCalledTimes(2);
    // A save hands the store the row: no refetch needed afterwards.
    const saved = { ...row, name: "Renamed" };
    useBotsStore.getState().setFullBot(saved);
    expect(await useBotsStore.getState().loadBot("b1")).toBe(saved);
    // Gone: both rows and the chat go.
    useBotsStore.getState().forgetBot("b1");
    expect(useBotsStore.getState().fullBots).toEqual({});
    expect(useBotsStore.getState().bots).toEqual([]);
  });
});

describe("bots store — loadBots resolves with the landed list (issue #119)", () => {
  beforeEach(() => {
    listeners.clear();
    useBotsStore.getState().disconnectActivity();
    vi.mocked(botsApi.list).mockReset();
    vi.mocked(botsApi.list).mockResolvedValue([]);
    useBotsStore.setState({ bots: [], loading: false });
  });

  it("resolves an unopposed load with its own list", async () => {
    const own = [listEntry("b1", "7")];
    vi.mocked(botsApi.list).mockResolvedValueOnce(own);
    const list = await useBotsStore.getState().loadBots();
    expect(list).toEqual(own);
  });

  it("resolves a superseded load with the newer request's list, not a stale snapshot", async () => {
    // The page's load starts first…
    const answerFirst = deferredList();
    const pageLoad = useBotsStore.getState().loadBots();
    // …a newer load (app mount / SSE refresh) supersedes it and lands first.
    const newest = [listEntry("b1", "7")];
    vi.mocked(botsApi.list).mockResolvedValueOnce(newest);
    await useBotsStore.getState().loadBots();
    // The stale response arrives last; it must not resolve the page's load
    // with the (possibly empty) pre-request snapshot of the store.
    answerFirst([]);
    await expect(pageLoad).resolves.toEqual(newest);
  });

  it("rejects a superseded load when the newest request fails", async () => {
    const answerFirst = deferredList();
    const pageLoad = useBotsStore.getState().loadBots();
    vi.mocked(botsApi.list).mockRejectedValueOnce(new Error("network down"));
    await useBotsStore
      .getState()
      .loadBots()
      .catch(() => undefined);
    answerFirst([]);
    await expect(pageLoad).rejects.toThrow("network down");
  });

  it("resolves the page's load across three overlapping generations (prod repro)", async () => {
    // Mount, page and SSE refresh can overlap: gen1 (the page) registers a
    // waiter on gen2, then gen3 supersedes gen2 before gen2 lands. Only the
    // newest request settles waiters — gen1's waiter on gen2 would be
    // stranded and the Memory page's skeleton would never resolve (prod).
    const answerGen1 = deferredList();
    const answerGen2 = deferredList();
    const pageLoad = useBotsStore.getState().loadBots();
    const middleLoad = useBotsStore.getState().loadBots();
    // gen1 lands while gen2 is still in flight: gen1 parks on gen2.
    answerGen1([]);
    await Promise.resolve();
    // gen3 starts and lands: it settles only its own waiters.
    const newest = [listEntry("b1", "7")];
    vi.mocked(botsApi.list).mockResolvedValueOnce(newest);
    await useBotsStore.getState().loadBots();
    answerGen2([]);
    await expect(middleLoad).resolves.toEqual(newest);
    await expect(pageLoad).resolves.toEqual(newest);
  });
});
