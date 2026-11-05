/**
 * Bot list + chat state store.
 *
 * - `bots` is the list the sidebar shows. The app's one `/events` feed keeps
 *   it live: a bot's replying state and its waiting counts (approvals,
 *   questions) are patched in as they change, and a reply that finished
 *   refetches the list for its preview and unread flag. A patch made while
 *   a list request is in flight outlives that request's response, so a
 *   badge never flickers off because an older list landed late.
 * - `fullBots` holds the full rows the chat and the edit dialog need, by id.
 * - `connections` is the live MCP connection status from the same feed.
 * - `chats` holds per-bot ChatState fed by the SSE stream: snapshot first,
 *   then minimal diffs applied in order. Reconnects receive a fresh snapshot.
 */
import { create } from "zustand";
import { toast } from "sonner";
import {
  botsApi,
  type Bot,
  type BotListEntry,
  type ModelInfo,
  type ProviderStatus,
} from "../lib/bots-api";
import { subscribeSse } from "../lib/sse";
import type {
  AttachmentRef,
  BotStreamEvent,
  ChatMessage,
  EventsFeedEvent,
  QueuedMessage,
  RoutineRunCard,
} from "../lib/chat-types";
import { errorMessage } from "../lib/errors";
import { mergeSnapshot, oldestEntryId, prependOlder } from "../lib/chat-history";

/** An Echo: the optimistic copy of an owner send, shown until the server confirms it. */
export interface PendingMessage {
  /** The send's request id, minted once (store/owner-send.ts) and reused by every retry. */
  id: string;
  text: string;
  createdAt: number;
  /** Attachment refs echoed optimistically (issue #17). */
  attachments?: AttachmentRef[];
}

/**
 * A bot's chat as the browser holds it: what the bot stream said (the
 * transcript window, busy, the queue, routine cards, YOLO mode) plus what
 * only the browser knows (Echoes, stream health, paging, the read marker).
 */
export interface ChatState {
  messages: ChatMessage[];
  /** Finished routine runs of this bot, oldest first: merged into the timeline by time. */
  routineRuns: RoutineRunCard[];
  busy: boolean;
  /** Owner inputs the server holds behind (or steering into) the reply. */
  queued: readonly QueuedMessage[];
  /** Locally echoed messages not yet confirmed by the server snapshot. */
  pending: PendingMessage[];
  /** False while the SSE stream is down (backend restart, network drop). */
  connected: boolean;
  /** True once the first snapshot arrived: until then the transcript is unknown, not empty. */
  loaded: boolean;
  /** Older messages exist above `messages[0]`; they load on scroll (issue #92). */
  hasMore?: boolean;
  /** YOLO mode (issue #151); unknown until its stream event arrives. */
  yolo?: boolean;
  /** A page of older messages is being fetched. */
  loadingOlder?: boolean;
  /** Pre-open read marker (epoch ms), seeded once when the chat connects (issue #3). */
  unreadFrom: number | null;
}

/** What changes a chat: a bot stream event, or the browser's own (Echoes, stream health). */
export type ChatEvent =
  | BotStreamEvent
  | { type: "pending-add"; message: PendingMessage }
  | { type: "pending-remove"; id: string }
  | { type: "connected"; connected: boolean };

/** An MCP connection's live state, as the events feed last reported it. */
export interface ConnectionLive {
  status: string;
  error?: string;
}

interface BotsState {
  bots: BotListEntry[];
  loading: boolean;
  error: string | null;
  gatewayConfigured: boolean;
  /** Inference providers and their setup state (the not-configured banner). */
  providers: ProviderStatus[];
  defaultModel?: string;
  models: ModelInfo[];
  /** Full rows by id, fetched on demand (the chat, the edit dialog). */
  fullBots: Record<string, Bot>;
  /** Live MCP connection status by id (the Connections pages' badges). */
  connections: Record<string, ConnectionLive>;

  /**
   * Refresh `bots` from the server. Resolves with the list that actually
   * landed — including when a newer load superseded this one (then the
   * newer list, once it lands) — so a caller that awaits and snapshots
   * (the Memory page) never reads a stale store. Fire-and-forget callers
   * ignore the value.
   */
  loadBots: () => Promise<BotListEntry[]>;
  loadModels: () => Promise<void>;
  refreshBotsInBackground: () => void;
  markRead: (botId: string) => void;
  /** Optimistic pin/unpin; rolls back and toasts if the server refuses. */
  togglePin: (botId: string) => Promise<void>;
  /**
   * The full bot, from the cache unless `fresh`. Rejects when it cannot be
   * loaded (gone, offline); the cached row, if any, stays.
   */
  loadBot: (botId: string, options?: { fresh?: boolean }) => Promise<Bot>;
  /** A full row the app just received (a save, New chat, a continued Past chat). */
  setFullBot: (bot: Bot) => void;
  /** The bot is gone: drop its rows and its chat. */
  forgetBot: (botId: string) => void;

  // Per-bot chat
  chats: Record<string, ChatState>;
  connectChat: (botId: string) => void;
  disconnectChat: (botId: string) => void;
  /**
   * New chat: the server moved the bot to a fresh conversation. Drop the
   * cached ChatState — the SSE connection still streams the retired
   * conversation, so until it is reopened the transcript would keep showing
   * (and growing) the old messages.
   */
  resetChat: (botId: string) => void;
  applyChatEvent: (botId: string, event: ChatEvent) => void;
  /** Fetch the page of messages above the oldest loaded one (issue #92). */
  loadOlder: (botId: string) => Promise<void>;

  // App-wide activity feed
  connectActivity: () => void;
  disconnectActivity: () => void;
}

let activityConnection: { close(): void } | null = null;
const chatConnections = new Map<string, { close(): void }>();
/** Sequence of `loadBots` calls; a response from an older call is dropped. */
let botsRequest = 0;
/**
 * How the request numbered `botsRequest` last settled, for `loadBots` calls
 * whose own response was superseded: their promise resolves/rejects with
 * the newest request's outcome. A late subscriber (the stale response
 * arrives after the newest already landed) reads it instead of waiting.
 */
let newestOutcome: { bots: BotListEntry[] } | { error: unknown } | undefined;
/**
 * Resolvers for `loadBots` calls still waiting on the newest request's list
 * (their own response was superseded). The newest call resolves them when
 * its list lands; a failing newest call rejects them with its error.
 */
const waitingForNewest = new Map<
  number,
  Array<{ resolve(bots: BotListEntry[]): void; reject(error: unknown): void }>
>();

/** Settle every waiter registered for `request` (no-op when there are none). */
function settleWaiters(
  request: number,
  settle: (waiter: { resolve(bots: BotListEntry[]): void; reject(error: unknown): void }) => void,
): void {
  const waiters = waitingForNewest.get(request);
  if (!waiters) return;
  waitingForNewest.delete(request);
  for (const waiter of waiters) settle(waiter);
}

/**
 * A superseded request may itself carry waiters (promised its outcome by an
 * even older caller). They will never be settled by it — only the newest
 * request settles — so carry them forward to the newest generation before
 * awaiting it; three overlapping loads (mount, page, SSE) otherwise strand
 * the oldest caller's promise forever.
 */
function carryWaitersForward(request: number): void {
  const stranded = waitingForNewest.get(request);
  if (!stranded) return;
  waitingForNewest.delete(request);
  // The newest request may have already landed (and settled its own waiters):
  // answer the stranded ones from its recorded outcome instead of parking
  // them on a generation whose settleWaiters already ran.
  if (newestOutcome !== undefined) {
    for (const waiter of stranded) {
      if ("error" in newestOutcome) waiter.reject(newestOutcome.error);
      else waiter.resolve(newestOutcome.bots);
    }
    return;
  }
  const current = waitingForNewest.get(botsRequest) ?? [];
  waitingForNewest.set(botsRequest, [...current, ...stranded]);
}

/**
 * A promise for the list the request numbered `request` will land, when that
 * request is newer than the caller's own (superseded) one.
 */
function newestBots(request: number): Promise<BotListEntry[]> {
  // The newest request already settled before this stale caller arrived.
  if (newestOutcome !== undefined && request === botsRequest) {
    return "error" in newestOutcome
      ? Promise.reject(newestOutcome.error)
      : Promise.resolve(newestOutcome.bots);
  }
  return new Promise((resolve, reject) => {
    const list = waitingForNewest.get(request) ?? [];
    list.push({ resolve, reject });
    waitingForNewest.set(request, list);
  });
}

/**
 * Local changes to list entries (replying, waiting counts, pin, read), each
 * stamped in order. A list response reflects only what the server knew when
 * the request started, so the patches made after that are re-applied over
 * it rather than lost; a later response that started after a patch carries
 * its result and retires it.
 */
interface ListPatch {
  seq: number;
  apply: (bot: BotListEntry) => BotListEntry;
}
let patchSeq = 0;
let patches: ListPatch[] = [];

function applyPatches(bots: BotListEntry[], list: readonly ListPatch[]): BotListEntry[] {
  if (list.length === 0) return bots;
  return bots.map((bot) => list.reduce((next, patch) => patch.apply(next), bot));
}

/** A reply ended: its preview and unread flag come from the list. Bursts refetch once. */
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const REFRESH_COALESCE_MS = 300;

export type ConnectionChange = Extract<EventsFeedEvent, { type: "connection" }>;
const connectionListeners = new Set<(change: ConnectionChange) => void>();

/**
 * Follow MCP connection changes from the app's one events feed (the
 * Connections pages refetch what they show). Returns the unsubscribe.
 */
export function onConnectionChange(listener: (change: ConnectionChange) => void): () => void {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
}

/** Attachment ids of a message, for echo matching (empty texts collide). */
function attachmentIds(message: { attachments?: { uploadId: string }[] }): string[] {
  return (message.attachments ?? []).map((a) => a.uploadId).sort();
}

/**
 * How far a legacy confirmation's server clock may run behind the Echo's
 * browser clock and still count as that Echo's.
 */
const LEGACY_ECHO_SKEW_MS = 5_000;

/**
 * Whether a confirmed user message is the Echo `pending`: by request id,
 * which every owner send records. A message without one (written before
 * request ids were recorded on every send) falls back to its text and
 * attachments, and only when it is not older than the Echo: an earlier
 * message with the same text ("ok") is never mistaken for a new Echo.
 */
export function echoMatches(
  pending: { id: string; text: string; createdAt: number; attachments?: { uploadId: string }[] },
  message: {
    text: string;
    requestId?: string;
    createdAt: number;
    attachments?: { uploadId: string }[];
  },
): boolean {
  if (message.requestId) return message.requestId === pending.id;
  return (
    message.createdAt >= pending.createdAt - LEGACY_ECHO_SKEW_MS &&
    pending.text.trim() === message.text.trim() &&
    attachmentIds(pending).join(",") === attachmentIds(message).join(",")
  );
}

/** A chat with nothing known yet: before its first snapshot. */
function emptyChat(unreadFrom: number | null = null): ChatState {
  return {
    messages: [],
    routineRuns: [],
    busy: false,
    queued: [],
    pending: [],
    connected: false,
    loaded: false,
    unreadFrom,
  };
}

/** The per-chat reducer: every stream, Echo and connection event lands here. */
export function applyEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "snapshot":
      // A fresh snapshot is authoritative: drop every Echo now confirmed by
      // a real user message (`echoMatches`), keep the rest
      // (still in flight). Echoes whose request id is queued server-side
      // are covered by the queued items instead. `unreadFrom` is session
      // state, not stream state, so it survives the replacement.
      return {
        ...event.state,
        // A reconnect's snapshot is the newest window again: keep the older
        // pages already loaded above it (issue #92).
        ...mergeSnapshot(state, event.state),
        loadingOlder: false,
        // Routine cards and YOLO ride their own events; a transcript snapshot keeps them.
        routineRuns: state.routineRuns,
        ...(state.yolo !== undefined ? { yolo: state.yolo } : {}),
        queued: event.state.queued ?? [],
        connected: true,
        loaded: true,
        pending: state.pending.filter(
          (p) =>
            !event.state.messages.some((m) => m.role === "user" && echoMatches(p, m)) &&
            !(event.state.queued ?? []).some((q) => q.requestId === p.id),
        ),
        unreadFrom: state.unreadFrom,
      };
    case "busy":
      return { ...state, busy: event.busy };
    case "routine-runs":
      return { ...state, routineRuns: event.runs };
    case "yolo":
      return state.yolo === event.on ? state : { ...state, yolo: event.on };
    case "routine-run":
      // Listed and followed at connect, a run can arrive twice: keep one.
      return state.routineRuns.some((run) => run.id === event.run.id)
        ? state
        : { ...state, routineRuns: [...state.routineRuns, event.run] };
    case "upsert": {
      // The confirmed user message replaces the matching optimistic echo.
      const pending =
        event.message.role === "user"
          ? state.pending.filter((p) => !echoMatches(p, event.message))
          : state.pending;
      return {
        ...state,
        pending,
        messages: state.messages.some((m) => m.id === event.message.id)
          ? state.messages.map((m) => (m.id === event.message.id ? event.message : m))
          : [...state.messages, event.message],
      };
    }
    case "remove":
      return { ...state, messages: state.messages.filter((m) => m.id !== event.id) };
    case "pending-add":
      return { ...state, pending: [...state.pending, event.message] };
    case "pending-remove":
      return { ...state, pending: state.pending.filter((p) => p.id !== event.id) };
    case "queued":
      // The server holds these behind (or steering into) the reply; the
      // matching optimistic echoes are superseded by the queued items.
      return {
        ...state,
        queued: event.items,
        pending: state.pending.filter((p) => !event.items.some((q) => q.requestId === p.id)),
      };
    case "connected":
      return { ...state, connected: event.connected };
    case "error":
      // The stream gave up on this connection; it reconnects with a fresh snapshot.
      return { ...state, connected: false };
    case "delta":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === event.id
            ? {
                ...m,
                text: m.text + (event.text ?? ""),
                reasoning: (m.reasoning ?? "") + (event.reasoning ?? ""),
              }
            : m,
        ),
      };
    default:
      return state;
  }
}

export const useBotsStore = create<BotsState>((set, get) => {
  /** Change list entries now, and keep the change over any list request already in flight. */
  const patchBots = (apply: (bot: BotListEntry) => BotListEntry) => {
    const patch = { seq: ++patchSeq, apply };
    patches.push(patch);
    set((state) => ({ bots: applyPatches(state.bots, [patch]) }));
  };
  const patchBot = (botId: string, fields: Partial<BotListEntry>) =>
    patchBots((bot) => (bot.id === botId ? { ...bot, ...fields } : bot));

  const scheduleRefresh = () => {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      get().refreshBotsInBackground();
    }, REFRESH_COALESCE_MS);
  };

  return {
    bots: [],
    loading: false,
    error: null,
    gatewayConfigured: false,
    providers: [],
    defaultModel: undefined,
    models: [],
    fullBots: {},
    connections: {},

    loadBots: async () => {
      // Loads overlap (mount, a create, activity events). Only the newest
      // may land: an older list answering last would drop a bot that was just
      // created, and the chat route would treat its link as stale.
      const request = ++botsRequest;
      const since = patchSeq;
      newestOutcome = undefined;
      set({ loading: true, error: null });
      try {
        const bots = await botsApi.list();
        if (request !== botsRequest) {
          // Superseded: a newer load owns the store now. Wait for the newest
          // request to land so awaiting callers still see a fresh list, not
          // the pre-request snapshot they'd read off the store.
          carryWaitersForward(request);
          return await newestBots(botsRequest);
        }
        // Patches older than this request are in its response (or the
        // server overruled them); the newer ones ride on top of it.
        patches = patches.filter((patch) => patch.seq > since);
        const landed = applyPatches(bots, patches);
        set({ bots: landed, loading: false });
        newestOutcome = { bots: landed };
        settleWaiters(request, (waiter) => waiter.resolve(landed));
        return landed;
      } catch (error) {
        if (request !== botsRequest) {
          // Superseded on failure: the newest request decides the store.
          // Surface this error only if nothing newer ever lands with data.
          carryWaitersForward(request);
          try {
            return await newestBots(botsRequest);
          } catch {
            return Promise.reject(error);
          }
        }
        newestOutcome = { error };
        settleWaiters(request, (waiter) => waiter.reject(error));
        set({
          loading: false,
          error: errorMessage(error, "Failed to load bots"),
        });
        return Promise.reject(error);
      }
    },

    loadModels: async () => {
      try {
        const { models, defaultModel, gatewayConfigured, providers } = await botsApi.models();
        set({
          gatewayConfigured,
          providers: providers ?? [],
          models,
          defaultModel: defaultModel ?? models[0]?.id,
        });
      } catch {
        // Banner state stays as-is; the chat pane shows its own error.
      }
    },

    togglePin: async (botId) => {
      const current = get().bots.find((bot) => bot.id === botId);
      if (!current) return;
      const pinned = current.pinnedAt === null;
      patchBot(botId, { pinnedAt: pinned ? new Date().toISOString() : null });
      try {
        const updated = await botsApi.pin(botId, pinned);
        patchBot(botId, { pinnedAt: updated.pinnedAt });
      } catch (error) {
        patchBot(botId, { pinnedAt: current.pinnedAt });
        toast.error(errorMessage(error, "Failed to update pin"));
      }
    },

    refreshBotsInBackground: () => {
      void get()
        .loadBots()
        .catch(() => undefined);
    },

    markRead: (botId) => {
      // The durable marker lives on the bot row (server lastReadAt); it is
      // frozen into chat state as `unreadFrom` at connect time, so there is
      // nothing to advance here — just clear the badge and persist.
      patchBot(botId, { unread: false });
      void botsApi.read(botId).catch(() => undefined);
    },

    loadBot: async (botId, { fresh = false } = {}) => {
      const cached = get().fullBots[botId];
      if (cached && !fresh) return cached;
      const bot = await botsApi.get(botId);
      get().setFullBot(bot);
      return bot;
    },

    setFullBot: (bot) => {
      set((state) => ({ fullBots: { ...state.fullBots, [bot.id]: bot } }));
    },

    forgetBot: (botId) => {
      get().resetChat(botId);
      set((state) => {
        const fullBots = { ...state.fullBots };
        delete fullBots[botId];
        return { fullBots, bots: state.bots.filter((bot) => bot.id !== botId) };
      });
    },

    chats: {},

    connectChat: (botId) => {
      if (chatConnections.has(botId)) return;
      // Freeze the pre-open read marker: everything newer arrived while the
      // owner was away and renders below the "new messages" divider. The
      // live marker advances via markRead; this one stays put for the open
      // session (WhatsApp-style unread divider).
      // The Bot (full) and BotListEntry (list) rows both carry lastReadAt.
      const bot = get().bots.find((b) => b.id === botId);
      const marker = bot?.lastReadAt;
      const unreadFrom = marker ? Date.parse(marker) : null;
      set((s) => ({
        chats: {
          ...s.chats,
          [botId]: s.chats[botId] ?? emptyChat(Number.isNaN(unreadFrom) ? null : unreadFrom),
        },
      }));
      const connection = subscribeSse(
        `/api/v1/bots/${botId}/stream`,
        (event) => get().applyChatEvent(botId, event as BotStreamEvent),
        {
          onOpen: () => get().applyChatEvent(botId, { type: "connected", connected: true }),
          onDrop: () => get().applyChatEvent(botId, { type: "connected", connected: false }),
        },
      );
      chatConnections.set(botId, connection);
    },

    disconnectChat: (botId) => {
      chatConnections.get(botId)?.close();
      chatConnections.delete(botId);
      // The cached transcript keeps rendering on the next visit, but it is
      // stale until that visit's first snapshot arrives.
      set((s) => {
        const chat = s.chats[botId];
        return chat
          ? { chats: { ...s.chats, [botId]: { ...chat, connected: false, loaded: false } } }
          : {};
      });
    },

    resetChat: (botId) => {
      get().disconnectChat(botId);
      set((s) => {
        const chats = { ...s.chats };
        delete chats[botId];
        return { chats };
      });
    },

    loadOlder: async (botId) => {
      const chat = get().chats[botId];
      const before = chat ? oldestEntryId(chat.messages) : undefined;
      if (!chat || !chat.hasMore || chat.loadingOlder || !before) return;
      const patch = (next: Partial<ChatState>) =>
        set((s) => {
          const current = s.chats[botId];
          return current ? { chats: { ...s.chats, [botId]: { ...current, ...next } } } : s;
        });
      patch({ loadingOlder: true });
      try {
        const page = await botsApi.history(botId, before);
        const current = get().chats[botId];
        // A new chat or a fresh snapshot meanwhile: this page no longer fits.
        if (!current || oldestEntryId(current.messages) !== before)
          return patch({ loadingOlder: false });
        patch({ ...prependOlder(current.messages, page), loadingOlder: false });
      } catch {
        // Stay loadable: the next scroll to the top tries again.
        patch({ loadingOlder: false });
      }
    },

    applyChatEvent: (botId, event) => {
      if (event.type === "ping") return;
      set((s) => ({
        chats: { ...s.chats, [botId]: applyEvent(s.chats[botId] ?? emptyChat(), event) },
      }));
    },

    connectActivity: () => {
      if (activityConnection) return;
      activityConnection = subscribeSse("/api/v1/events", (event) => {
        const typed = event as EventsFeedEvent;
        if (typed.type === "connection") {
          const { id, status, error } = typed;
          set((state) => ({
            connections: {
              ...state.connections,
              [id]: { status, ...(error !== undefined ? { error } : {}) },
            },
          }));
          for (const listener of connectionListeners) listener(typed);
          return;
        }
        if (typed.type !== "activity") return;
        if (!("conversation" in typed)) {
          // The feed (re)opened with who is replying now. Anything missed
          // while it was down is in the list.
          const busy = new Set(typed.busy);
          patchBots((bot) => ({ ...bot, replying: busy.has(bot.conversationId) }));
          get().refreshBotsInBackground();
          return;
        }
        const { conversation, approvals, questions } = typed;
        // A routine's or a retired chat's conversation is nobody's row.
        if (!get().bots.some((bot) => bot.conversationId === conversation)) return;
        const counts = {
          ...(approvals !== undefined ? { approvals } : {}),
          ...(questions !== undefined ? { questions } : {}),
        };
        // A tool waiting for approval or answers pauses a busy run: the
        // counts arrive here, mid-run, and the badge must not wait for the
        // reply to end.
        patchBots((bot) =>
          bot.conversationId === conversation ? { ...bot, replying: typed.busy, ...counts } : bot,
        );
        // The reply that ended changed the preview and unread flag.
        if (!typed.busy) scheduleRefresh();
      });
    },

    disconnectActivity: () => {
      activityConnection?.close();
      activityConnection = null;
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    },
  };
});
