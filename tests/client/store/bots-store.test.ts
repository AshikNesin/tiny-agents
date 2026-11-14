/**
 * The bot list store: the activity feed's live patches, full rows (and
 * adopting a fresh one drops a chat that moved conversation), and
 * overlapping list loads. Chat sessions have their own tests
 * (chats.test.ts, chat-session.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const listeners = new Map<string, (event: unknown) => void>();

vi.mock("../../../apps/web/src/client/lib/bots-api", () => ({
  botsApi: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    read: vi.fn().mockResolvedValue(undefined),
    models: vi.fn().mockResolvedValue({ models: [], defaultModel: undefined, canAnswer: true }),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../apps/web/src/client/lib/sse", () => ({
  subscribeSse: vi.fn((path: string, onEvent: (e: unknown) => void) => {
    listeners.set(path, onEvent);
    return { close: () => listeners.delete(path) };
  }),
}));

import { onConnectionChange, useBotsStore } from "../../../apps/web/src/client/store/bots";
import { chatSessions } from "../../../apps/web/src/client/store/chats";
import { botsApi, type Bot, type BotListEntry } from "../../../apps/web/src/client/lib/bots-api";
import type { EventsFeedEvent } from "../../../apps/web/src/client/lib/chat-types";

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
    return listeners.get("/api/v1/events") as (event: EventsFeedEvent) => void;
  };
  /** A conversation's activity change, as the feed sends it. */
  const activity = (
    conversation: string,
    busy: boolean,
    waiting: { approvals?: number; questions?: number } = {},
  ): EventsFeedEvent => ({
    type: "activity",
    conversation,
    busy,
    approvals: waiting.approvals ?? 0,
    questions: waiting.questions ?? 0,
  });

  it("updates the approvals and questions badge while the bot is still replying", () => {
    const onEvent = feed();
    onEvent(activity("7", true, { approvals: 0 }));
    // A tool call now waits for the owner: same busy run, new count.
    onEvent(activity("7", true, { approvals: 1 }));
    expect(useBotsStore.getState().bots[0]).toMatchObject({ replying: true, approvals: 1 });
    // The bot asks the owner questions: same run, its own count.
    onEvent(activity("7", true, { approvals: 0, questions: 2 }));
    expect(useBotsStore.getState().bots[0]).toMatchObject({ approvals: 0, questions: 2 });
  });

  it("keeps a waiting badge that arrived while an older list request was in flight", async () => {
    const onEvent = feed();
    // A list request starts (another bot went idle)…
    const answer = deferredList();
    const load = useBotsStore.getState().loadBots();
    // …then this bot asks for an approval, mid-run.
    onEvent(activity("7", true, { approvals: 1 }));
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
      onEvent(activity("7", true));
      expect(useBotsStore.getState().bots[0]!.replying).toBe(true);
      // A routine's conversation and a retired chat: no row, no list request.
      onEvent(activity("42", false));
      await vi.advanceTimersByTimeAsync(1000);
      expect(botsApi.list).not.toHaveBeenCalled();
      // The chat's reply ends: replying clears at once; preview and unread
      // come from one list request, however many idles land together.
      onEvent(activity("7", false));
      onEvent(activity("7", false));
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
    chatSessions.store.setState({ sessions: {} });
    vi.mocked(botsApi.get).mockReset();
    vi.mocked(botsApi.list).mockReset();
    vi.mocked(botsApi.list).mockResolvedValue([]);
  });

  const row = (conversationId: string) =>
    ({ id: "b1", name: "Bot", conversationId }) as unknown as Bot;

  /** Open the bot's chat and let its stream deliver a transcript. */
  function openChat(text: string) {
    chatSessions.open("b1", null);
    listeners.get("/api/v1/bots/b1/stream")!({
      type: "snapshot",
      state: {
        messages: [{ id: "e1", role: "user", text, status: "done", createdAt: 1 }],
        busy: false,
        queued: [],
      },
    });
  }

  it("loads a full bot once and serves it from the cache until asked for a fresh one", async () => {
    vi.mocked(botsApi.get).mockResolvedValue(row("7"));
    const first = await useBotsStore.getState().loadBot("b1");
    expect(await useBotsStore.getState().loadBot("b1")).toBe(first);
    expect(botsApi.get).toHaveBeenCalledTimes(1);
    await useBotsStore.getState().loadBot("b1", { fresh: true });
    expect(botsApi.get).toHaveBeenCalledTimes(2);
    // A save hands the store the row: no refetch needed afterwards.
    const saved = { ...row("7"), name: "Renamed" };
    useBotsStore.getState().adoptBot(saved);
    expect(await useBotsStore.getState().loadBot("b1")).toBe(saved);
  });

  it("adopting a row keeps the chat on the same conversation and refreshes the list", () => {
    useBotsStore.getState().adoptBot(row("7"));
    openChat("still here");
    useBotsStore.getState().adoptBot({ ...row("7"), name: "Renamed" });
    expect(chatSessions.store.getState().sessions.b1!.messages).toHaveLength(1);
    expect(listeners.has("/api/v1/bots/b1/stream")).toBe(true);
    expect(botsApi.list).toHaveBeenCalledTimes(2);
  });

  it("adopting a bot on a new conversation drops the cached transcript first", () => {
    useBotsStore.getState().adoptBot(row("7"));
    openChat("old conversation");
    // New chat (or a continued Past chat): the row names another conversation.
    useBotsStore.getState().adoptBot(row("8"));
    expect(chatSessions.store.getState().sessions.b1).toBeUndefined();
    expect(listeners.has("/api/v1/bots/b1/stream")).toBe(false);
    expect(useBotsStore.getState().fullBots.b1!.conversationId).toBe("8");
    expect(botsApi.list).toHaveBeenCalledTimes(2);
  });

  it("forgets a bot that is gone: its rows, its chat, and the list refreshes", () => {
    useBotsStore.getState().adoptBot(row("7"));
    openChat("bye");
    useBotsStore.getState().forgetBot("b1");
    expect(useBotsStore.getState().fullBots).toEqual({});
    expect(useBotsStore.getState().bots).toEqual([]);
    expect(chatSessions.store.getState().sessions.b1).toBeUndefined();
    expect(botsApi.list).toHaveBeenCalledTimes(2);
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
