/**
 * Bot list store.
 *
 * - `bots` is the list the sidebar shows. The app's one `/events` feed keeps
 *   it live: a bot's replying state and its waiting counts (approvals,
 *   questions) are patched in as they change, and a reply that finished
 *   refetches the list for its preview and unread flag. A patch made while
 *   a list request is in flight outlives that request's response, so a
 *   badge never flickers off because an older list landed late.
 * - `fullBots` holds the full rows the chat and the edit dialog need, by id.
 * - `connections` is the live MCP connection status from the same feed.
 *
 * Each bot's chat is its own session (store/chats.ts, read through
 * `useChat`); this store only drops one when the bot's row moves it to
 * another conversation (`adoptBot`) or the bot is gone (`forgetBot`).
 */
import { create } from "zustand";
import { toast } from "sonner";
import {
  botsApi,
  type Bot,
  type BotListEntry,
  type CatalogModel,
  type ProviderSummary,
} from "../lib/bots-api";
import { subscribeSse } from "../lib/sse";
import type { EventsFeedEvent } from "../lib/chat-types";
import { errorMessage } from "../lib/errors";
import { chatSessions } from "./chats";

/** An MCP connection's live state, as the events feed last reported it. */
interface ConnectionLive {
  status: string;
  error?: string;
}

interface BotsState {
  bots: BotListEntry[];
  loading: boolean;
  error: string | null;
  canAnswer: boolean;
  /** Inference providers and their setup state (the not-configured banner). */
  providers: ProviderSummary[];
  defaultModel?: string;
  models: CatalogModel[];
  /** Full rows by id, fetched on demand (the chat, the edit dialog). */
  fullBots: Record<string, Bot>;
  /** Live MCP connection status by id (the Connections pages' badges). */
  connections: Record<string, ConnectionLive>;

  /**
   * Refresh `bots` from the server. Resolves with the list that actually
   * landed, including when a newer load superseded this one (then the
   * newer list, once it lands), so a caller that awaits and snapshots
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
  /**
   * A full row the app just received (a save, New chat, a continued Past
   * chat): store it, and refresh the list. When it names another
   * conversation, the cached chat is dropped first, so the chat reopens on
   * the new conversation instead of showing (and growing) the old one.
   */
  adoptBot: (bot: Bot) => void;
  /** The bot is gone: drop its rows and its chat, and refresh the list. */
  forgetBot: (botId: string) => void;

  // App-wide activity feed
  connectActivity: () => void;
  disconnectActivity: () => void;
}

let activityConnection: { close(): void } | null = null;
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
 * even older caller). They will never be settled by it, only the newest
 * request settles, so carry them forward to the newest generation before
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

export const useBotsStore = create<BotsState>((set, get) => {
  /** Change list entries now, and keep the change over any list request already in flight. */
  const patchBots = (apply: (bot: BotListEntry) => BotListEntry) => {
    const patch = { seq: ++patchSeq, apply };
    patches.push(patch);
    set((state) => ({ bots: applyPatches(state.bots, [patch]) }));
  };
  const patchBot = (botId: string, fields: Partial<BotListEntry>) =>
    patchBots((bot) => (bot.id === botId ? { ...bot, ...fields } : bot));

  /**
   * Store a full row. A row on another conversation than the one cached
   * drops the bot's chat first: the order matters, or the pane reconnects
   * while the old transcript stays on screen.
   */
  const storeRow = (bot: Bot) => {
    const state = get();
    const known =
      state.fullBots[bot.id]?.conversationId ??
      state.bots.find((entry) => entry.id === bot.id)?.conversationId;
    if (known !== undefined && known !== bot.conversationId) chatSessions.drop(bot.id);
    set((current) => ({ fullBots: { ...current.fullBots, [bot.id]: bot } }));
  };

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
    canAnswer: false,
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
        const { models, defaultModelId, canAnswer, providers } = await botsApi.models();
        set({
          canAnswer,
          providers,
          models,
          defaultModel: defaultModelId ?? undefined,
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
      // nothing to advance here, just clear the badge and persist.
      patchBot(botId, { unread: false });
      void botsApi.read(botId).catch(() => undefined);
    },

    loadBot: async (botId, { fresh = false } = {}) => {
      const cached = get().fullBots[botId];
      if (cached && !fresh) return cached;
      const bot = await botsApi.get(botId);
      storeRow(bot);
      return bot;
    },

    adoptBot: (bot) => {
      storeRow(bot);
      // The row's list entry changed too (name, model, preview after New chat).
      get().refreshBotsInBackground();
    },

    forgetBot: (botId) => {
      chatSessions.drop(botId);
      set((state) => {
        const fullBots = { ...state.fullBots };
        delete fullBots[botId];
        return { fullBots, bots: state.bots.filter((bot) => bot.id !== botId) };
      });
      get().refreshBotsInBackground();
    },

    connectActivity: () => {
      if (activityConnection) return;
      activityConnection = subscribeSse("/api/v1/events", (event) => {
        const typed = event as EventsFeedEvent;
        if (typed.type === "models.changed") {
          void get().loadModels();
          return;
        }
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
        // A tool waiting for approval or answers pauses a busy run: the
        // counts arrive here, mid-run, and the badge must not wait for the
        // reply to end.
        patchBots((bot) =>
          bot.conversationId === conversation
            ? { ...bot, replying: typed.busy, approvals, questions }
            : bot,
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
