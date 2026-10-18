/**
 * Bot list + chat state store.
 *
 * - `bots` is refetched on activity-feed events (typing started/stopped,
 *   which also refreshes previews + unread badges).
 * - `chats` holds per-bot ChatState fed by the SSE stream: snapshot first,
 *   then minimal diffs applied in order. Reconnects receive a fresh snapshot.
 */
import { create } from "zustand";
import { botsApi, type BotListEntry } from "../lib/bots-api";
import { subscribeSse } from "../lib/sse";
import type { ChatEvent, ChatState } from "../lib/chat-types";

interface BotsState {
  bots: BotListEntry[];
  loading: boolean;
  error: string | null;
  gatewayConfigured: boolean;
  defaultModel?: string;

  loadBots: () => Promise<void>;
  loadModels: () => Promise<void>;
  refreshBotsInBackground: () => void;
  markRead: (botId: string) => void;

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

  // App-wide activity feed
  connectActivity: () => void;
  disconnectActivity: () => void;
}

let activityConnection: { close(): void } | null = null;
const chatConnections = new Map<string, { close(): void }>();

function applyEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "snapshot":
      // A fresh snapshot is authoritative: drop every pending echo whose
      // text now appears as a real user message (confirmed), keep the rest
      // (still in flight).
      return {
        ...event.state,
        connected: true,
        pending: state.pending.filter(
          (p) =>
            !event.state.messages.some((m) => m.role === "user" && m.text.trim() === p.text.trim()),
        ),
      };
    case "busy":
      return { ...state, busy: event.busy };
    case "upsert": {
      // The confirmed user message replaces the matching optimistic echo.
      const pending =
        event.message.role === "user"
          ? state.pending.filter((p) => p.text.trim() !== event.message.text.trim())
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
    case "connected":
      return { ...state, connected: event.connected };
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

export const useBotsStore = create<BotsState>((set, get) => ({
  bots: [],
  loading: false,
  error: null,
  gatewayConfigured: false,
  defaultModel: undefined,

  loadBots: async () => {
    set({ loading: true, error: null });
    try {
      const bots = await botsApi.list();
      set({ bots, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load bots",
      });
    }
  },

  loadModels: async () => {
    try {
      const { models, defaultModel, gatewayConfigured } = await botsApi.models();
      set({ gatewayConfigured, defaultModel: defaultModel ?? models[0]?.id });
    } catch {
      // Banner state stays as-is; the chat pane shows its own error.
    }
  },

  refreshBotsInBackground: () => {
    void get()
      .loadBots()
      .catch(() => undefined);
  },

  markRead: (botId) => {
    set((state) => ({
      bots: state.bots.map((bot) => (bot.id === botId ? { ...bot, unread: false } : bot)),
    }));
    void botsApi.read(botId).catch(() => undefined);
  },

  chats: {},

  connectChat: (botId) => {
    if (chatConnections.has(botId)) return;
    set((s) => ({
      chats: {
        ...s.chats,
        [botId]: s.chats[botId] ?? { messages: [], busy: false, pending: [], connected: false },
      },
    }));
    const connection = subscribeSse(
      `/api/v1/bots/${botId}/stream`,
      (event) => {
        const typed = event as ChatEvent;
        if (typed.type === "error") {
          set((s) => ({
            chats: {
              ...s.chats,
              [botId]: {
                ...(s.chats[botId] ?? { messages: [], busy: false, pending: [], connected: false }),
                connected: false,
              },
            },
          }));
          return;
        }
        get().applyChatEvent(botId, typed);
      },
      { onOpen: () => get().applyChatEvent(botId, { type: "connected", connected: true }) },
    );
    chatConnections.set(botId, connection);
  },

  disconnectChat: (botId) => {
    chatConnections.get(botId)?.close();
    chatConnections.delete(botId);
  },

  resetChat: (botId) => {
    get().disconnectChat(botId);
    set((s) => {
      const chats = { ...s.chats };
      delete chats[botId];
      return { chats };
    });
  },

  applyChatEvent: (botId, event) => {
    if (event.type === "ping" || event.type === "error") return;
    set((s) => ({
      chats: {
        ...s.chats,
        [botId]: applyEvent(
          s.chats[botId] ?? { messages: [], busy: false, pending: [], connected: false },
          event,
        ),
      },
    }));
  },

  connectActivity: () => {
    if (activityConnection) return;
    activityConnection = subscribeSse("/api/v1/events", (event) => {
      const typed = event as ChatEvent;
      if (typed.type !== "activity") return;
      if (!("conversation" in typed)) {
        get().refreshBotsInBackground();
        return;
      }
      if (typed.busy) {
        set((state) => ({
          bots: state.bots.map((bot) =>
            bot.conversationId === typed.conversation ? { ...bot, replying: true } : bot,
          ),
        }));
        return;
      }
      get().refreshBotsInBackground();
    });
  },

  disconnectActivity: () => {
    activityConnection?.close();
    activityConnection = null;
  },
}));
