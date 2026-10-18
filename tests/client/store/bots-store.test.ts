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
