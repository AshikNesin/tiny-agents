/**
 * Store behavior for optimistic sends and stream-health state — the fixes
 * for "sent message not showing in UI" (echo before server confirm, SSE
 * reconnect instead of give-up, visible Reconnecting banner).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners = new Map<string, (event: unknown) => void>();
const openCallbacks: Array<() => void> = [];

vi.mock("../../../apps/web/src/client/lib/bots-api", () => ({
  botsApi: {
    list: vi.fn().mockResolvedValue([]),
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

import { useBotsStore } from "../../../apps/web/src/client/store/bots";

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

    // The connectChat callback handles {type:error} by clearing connected.
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

describe("bots store — activity feed", () => {
  beforeEach(() => {
    listeners.clear();
    useBotsStore.getState().disconnectActivity();
  });

  it("updates the approvals and questions badge while the bot is still replying", () => {
    useBotsStore.setState({
      bots: [
        {
          id: "b1",
          conversationId: "7",
          name: "Bot",
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
        },
      ],
    });
    useBotsStore.getState().connectActivity();
    const onEvent = listeners.get("/api/v1/events")!;
    onEvent({ type: "activity", conversation: "7", busy: true, approvals: 0 });
    // A tool call now waits for the owner: same busy run, new count.
    onEvent({ type: "activity", conversation: "7", busy: true, approvals: 1 });
    expect(useBotsStore.getState().bots[0]).toMatchObject({ replying: true, approvals: 1 });
    // The bot asks the owner questions: same run, its own count.
    onEvent({ type: "activity", conversation: "7", busy: true, approvals: 0, questions: 2 });
    expect(useBotsStore.getState().bots[0]).toMatchObject({ approvals: 0, questions: 2 });
  });
});
