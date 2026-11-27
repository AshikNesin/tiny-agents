import { describe, expect, it, vi } from "vite-plus/test";
import { ApiError } from "@groot/shell/lib/api";

vi.mock("../../../apps/web/src/client/lib/bots-api", () => ({ botsApi: {} }));

import {
  createChatSessions,
  type ChatPorts,
  type OwnerSubmission,
} from "../../../apps/web/src/client/store/chats";
import { chatView } from "../../../apps/web/src/client/lib/chat-session";
import type { BotStreamEvent, ChatPage } from "../../../apps/web/src/client/lib/chat-types";

const SUBMISSION: OwnerSubmission = {
  body: "ok",
  attachments: [],
  mentions: [],
  whenBusy: "steer",
};

function harness(responses: Array<() => Promise<unknown>> = []) {
  let online = true;
  const onlineListeners = new Set<() => void>();
  const errors: string[] = [];
  const streams = new Map<string, Parameters<ChatPorts["stream"]>[1]>();
  const send = vi.fn((..._args: unknown[]) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected send");
    return next();
  });
  let ids = 0;
  const ports: ChatPorts = {
    stream: (botId, handlers) => {
      streams.set(botId, handlers);
      return { close: () => streams.delete(botId) };
    },
    send: (...args) => send(...args),
    withdraw: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    setYolo: vi.fn(async (_botId: string, on: boolean) => ({ on })),
    history: vi.fn<(botId: string, before: string) => Promise<ChatPage>>(),
    pastChat: vi.fn(),
    pastChatHistory: vi.fn(),
    isOnline: () => online,
    whenOnline: (listener) => {
      onlineListeners.add(listener);
      return () => onlineListeners.delete(listener);
    },
    notifyError: (message) => errors.push(message),
    newId: () => `req-${++ids}`,
    now: () => 1_000,
  };
  const chats = createChatSessions(ports);
  return {
    chats,
    ports,
    send,
    errors,
    streams,
    emit: (botId: string, ...events: BotStreamEvent[]) => {
      for (const event of events) streams.get(botId)!.onEvent(event);
    },
    view: (botId: string) => chatView(chats.store.getState().sessions[botId]!),
    goOffline: () => {
      online = false;
    },
    goOnline: () => {
      online = true;
      for (const listener of Array.from(onlineListeners)) listener();
    },
  };
}

const outbox = (h: ReturnType<typeof harness>, botId = "b1") =>
  h.view(botId).outbox.map((entry) => `${entry.requestId}:${entry.state}`);

const lostAnswer = () => Promise.reject(new TypeError("Failed to fetch"));
const refused = () =>
  Promise.reject(
    new ApiError({
      status: 409,
      code: "CONFLICT",
      message: "The bot was deleted",
      url: "/bots/b1/messages",
      fromServer: true,
    }),
  );
const accepted = () => Promise.resolve({});

describe("chat sessions: owner send", () => {
  it("shows the Echo and sends it under its request id", async () => {
    const h = harness([accepted]);
    h.chats.open("b1", null);
    await expect(h.chats.send("b1", SUBMISSION)).resolves.toBe("sent");
    expect(outbox(h)).toEqual(["req-1:sending"]);
    expect(h.send).toHaveBeenCalledWith("b1", "req-1", "ok", [], [], "steer", []);
  });

  it("resends an offline send with the same request id once back online (no duplicate)", async () => {
    const h = harness([lostAnswer, accepted]);
    h.chats.open("b1", null);
    h.goOffline();
    const outcome = h.chats.send("b1", SUBMISSION);
    await vi.waitFor(() => expect(outbox(h)).toEqual(["req-1:offline"]));
    await Promise.resolve();
    expect(h.send).toHaveBeenCalledTimes(1);

    h.goOnline();
    expect(outbox(h)).toEqual(["req-1:sending"]);
    await expect(outcome).resolves.toBe("sent");
    expect(h.send.mock.calls.map((call) => call[1])).toEqual(["req-1", "req-1"]);
    expect(h.errors).toEqual([]);
  });

  it("keeps waiting while a resend finds the browser offline again", async () => {
    const h = harness([lostAnswer, accepted]);
    h.chats.open("b1", null);
    h.goOffline();
    const outcome = h.chats.send("b1", SUBMISSION);
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
    h.send.mockImplementationOnce(() => {
      h.goOffline();
      return lostAnswer();
    });
    h.goOnline();
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(outbox(h)).toEqual(["req-1:offline"]));
    h.goOnline();
    await expect(outcome).resolves.toBe("sent");
    expect(new Set(h.send.mock.calls.map((call) => call[1]))).toEqual(new Set(["req-1"]));
  });

  it("withdraws the Echo and restores the draft when the server refuses", async () => {
    const h = harness([refused]);
    h.chats.open("b1", null);
    await expect(h.chats.send("b1", SUBMISSION)).resolves.toBe("restored");
    expect(outbox(h)).toEqual([]);
    expect(h.errors).toEqual(["The bot was deleted"]);
  });

  it("restores the draft when no answer came while online", async () => {
    const h = harness([lostAnswer]);
    h.chats.open("b1", null);
    await expect(h.chats.send("b1", SUBMISSION)).resolves.toBe("restored");
    expect(outbox(h)).toEqual([]);
  });

  it("toasts and rethrows a refused stop; toasts a refused withdrawal", async () => {
    const h = harness();
    vi.mocked(h.ports.abort).mockRejectedValueOnce(new Error("nope"));
    await expect(h.chats.stop("b1")).rejects.toThrow("nope");
    vi.mocked(h.ports.withdraw).mockRejectedValueOnce(new Error("Already answered"));
    await h.chats.withdraw("b1", "req-9");
    expect(h.ports.withdraw).toHaveBeenCalledWith("b1", "req-9");
    expect(h.errors).toEqual(["Failed to stop the reply", "Already answered"]);
  });
});

describe("chat sessions: the stream and the cache", () => {
  const hi = { id: "e1", role: "user" as const, text: "hi", status: "done" as const, createdAt: 1 };

  it("follows the stream while open and keeps the transcript for the next visit", () => {
    const h = harness();
    h.chats.open("b1", 500);
    h.streams.get("b1")!.onOpen();
    h.emit("b1", { type: "snapshot", state: { messages: [hi], busy: false, queued: [] } });
    expect(h.view("b1")).toMatchObject({ health: "live", messages: [hi] });

    h.chats.close("b1");
    expect(h.streams.has("b1")).toBe(false);
    expect(h.view("b1")).toMatchObject({ health: "loading", messages: [hi] });
    h.chats.open("b1", 9_999);
    expect(h.chats.store.getState().sessions.b1!.unreadFrom).toBe(500);
    h.streams.get("b1")!.onDrop();
    expect(h.view("b1").messages).toEqual([hi]);
  });

  it("drops a chat outright: nothing of the old transcript shows when it reopens", () => {
    const h = harness();
    h.chats.open("b1", null);
    h.emit("b1", { type: "snapshot", state: { messages: [hi], busy: true, queued: [] } });
    h.chats.drop("b1");
    expect(h.streams.has("b1")).toBe(false);
    expect(h.chats.store.getState().sessions.b1).toBeUndefined();

    h.chats.open("b1", null);
    h.emit("b1", { type: "snapshot", state: { messages: [], busy: false, queued: [] } });
    expect(h.view("b1")).toMatchObject({ messages: [], busy: false });
  });

  it("loads the page above the oldest message once at a time, and shows YOLO switches at once", async () => {
    const h = harness();
    h.chats.open("b1", null);
    const window = { messages: [{ ...hi, id: "e5" }], busy: false, queued: [], hasMore: true };
    h.emit("b1", { type: "snapshot", state: window });
    let answer!: (page: ChatPage) => void;
    vi.mocked(h.ports.history).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const loading = h.chats.loadOlder("b1");
    expect(h.view("b1").loadingOlder).toBe(true);
    await h.chats.loadOlder("b1");
    expect(h.ports.history).toHaveBeenCalledTimes(1);
    answer({ messages: [hi], hasMore: false });
    await loading;
    expect(h.view("b1")).toMatchObject({ hasMore: false, loadingOlder: false });
    expect(h.view("b1").messages.map((m) => m.id)).toEqual(["e1", "e5"]);

    await h.chats.setYolo("b1", true);
    expect(h.view("b1").yolo).toBe(true);
  });
});
