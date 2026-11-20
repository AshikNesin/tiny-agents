import { create } from "zustand";
import { toast } from "sonner";
import type { Bot, BotListEntry } from "../../shared/api/bots";
import type { CatalogModel, ProviderSummary } from "../../shared/api/models";
import { botsApi } from "../lib/bots-api";
import { subscribeSse } from "../lib/sse";
import type { EventsFeedEvent } from "../lib/chat-types";
import { errorMessage } from "../lib/errors";
import { chatSessions } from "./chats";

interface ConnectionLive {
  status: string;
  error?: string;
}

interface BotsState {
  bots: BotListEntry[];
  loading: boolean;
  error: string | null;
  canAnswer: boolean;
  providers: ProviderSummary[];
  defaultModel?: string;
  models: CatalogModel[];
  fullBots: Record<string, Bot>;
  connections: Record<string, ConnectionLive>;

  loadBots: () => Promise<BotListEntry[]>;
  loadModels: () => Promise<void>;
  refreshBotsInBackground: () => void;
  markRead: (botId: string) => void;
  togglePin: (botId: string) => Promise<void>;
  loadBot: (botId: string, options?: { fresh?: boolean }) => Promise<Bot>;
  adoptBot: (bot: Bot) => void;
  forgetBot: (botId: string) => void;

  connectActivity: () => void;
  disconnectActivity: () => void;
}

let activityConnection: { close(): void } | null = null;
let botsRequest = 0;
let newestOutcome: { bots: BotListEntry[] } | { error: unknown } | undefined;
const waitingForNewest = new Map<
  number,
  Array<{ resolve(bots: BotListEntry[]): void; reject(error: unknown): void }>
>();

function settleWaiters(
  request: number,
  settle: (waiter: { resolve(bots: BotListEntry[]): void; reject(error: unknown): void }) => void,
): void {
  const waiters = waitingForNewest.get(request);
  if (!waiters) return;
  waitingForNewest.delete(request);
  for (const waiter of waiters) settle(waiter);
}

function carryWaitersForward(request: number): void {
  const stranded = waitingForNewest.get(request);
  if (!stranded) return;
  waitingForNewest.delete(request);
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

function newestBots(request: number): Promise<BotListEntry[]> {
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

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const REFRESH_COALESCE_MS = 300;

export type ConnectionChange = Extract<EventsFeedEvent, { type: "connection" }>;
const connectionListeners = new Set<(change: ConnectionChange) => void>();

export function onConnectionChange(listener: (change: ConnectionChange) => void): () => void {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
}

export const useBotsStore = create<BotsState>((set, get) => {
  const patchBots = (apply: (bot: BotListEntry) => BotListEntry) => {
    const patch = { seq: ++patchSeq, apply };
    patches.push(patch);
    set((state) => ({ bots: applyPatches(state.bots, [patch]) }));
  };
  const patchBot = (botId: string, fields: Partial<BotListEntry>) =>
    patchBots((bot) => (bot.id === botId ? { ...bot, ...fields } : bot));

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
      const request = ++botsRequest;
      const since = patchSeq;
      newestOutcome = undefined;
      set({ loading: true, error: null });
      try {
        const bots = await botsApi.list();
        if (request !== botsRequest) {
          carryWaitersForward(request);
          return await newestBots(botsRequest);
        }
        patches = patches.filter((patch) => patch.seq > since);
        const landed = applyPatches(bots, patches);
        set({ bots: landed, loading: false });
        newestOutcome = { bots: landed };
        settleWaiters(request, (waiter) => waiter.resolve(landed));
        return landed;
      } catch (error) {
        if (request !== botsRequest) {
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
      } catch {}
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
          const busy = new Set(typed.busy);
          patchBots((bot) => ({ ...bot, replying: busy.has(bot.conversationId) }));
          get().refreshBotsInBackground();
          return;
        }
        const { conversation, approvals, questions } = typed;
        if (!get().bots.some((bot) => bot.conversationId === conversation)) return;
        patchBots((bot) =>
          bot.conversationId === conversation
            ? { ...bot, replying: typed.busy, approvals, questions }
            : bot,
        );
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
