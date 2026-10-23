/**
 * Bot list + chat state store.
 *
 * - `bots` is refetched on activity-feed events (typing started/stopped,
 *   which also refreshes previews + unread badges).
 * - `chats` holds per-bot ChatState fed by the SSE stream: snapshot first,
 *   then minimal diffs applied in order. Reconnects receive a fresh snapshot.
 */
import { create } from "zustand";
import { toast } from "sonner";
import { botsApi, type BotListEntry, type ModelInfo } from "../lib/bots-api";
import { subscribeSse } from "../lib/sse";
import type { ChatEvent, ChatState } from "../lib/chat-types";

interface BotsState {
  bots: BotListEntry[];
  loading: boolean;
  error: string | null;
  gatewayConfigured: boolean;
  defaultModel?: string;
  models: ModelInfo[];

  loadBots: () => Promise<void>;
  loadModels: () => Promise<void>;
  refreshBotsInBackground: () => void;
  markRead: (botId: string) => void;
  /** Optimistic pin/unpin; rolls back and toasts if the server refuses. */
  togglePin: (botId: string) => Promise<void>;

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
/** Sequence of `loadBots` calls; a response from an older call is dropped. */
let botsRequest = 0;

/** Attachment ids of a message, for echo matching (empty texts collide). */
function attachmentIds(message: { attachments?: { uploadId: string }[] }): string[] {
  return (message.attachments ?? []).map((a) => a.uploadId).sort();
}

function echoMatches(
  pending: { text: string; attachments?: { uploadId: string }[] },
  message: { text: string; attachments?: { uploadId: string }[] },
): boolean {
  return (
    pending.text.trim() === message.text.trim() &&
    attachmentIds(pending).join(",") === attachmentIds(message).join(",")
  );
}

function applyEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "snapshot":
      // A fresh snapshot is authoritative: drop every pending echo whose
      // text now appears as a real user message (confirmed), keep the rest
      // (still in flight). Echoes whose request id is queued server-side
      // are covered by the queued items instead. `unreadFrom` is session
      // state, not stream state, so it survives the replacement.
      return {
        ...event.state,
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
  models: [],

  loadBots: async () => {
    // Loads overlap (mount, a create, activity events). Only the newest
    // may land: an older list answering last would drop a bot that was just
    // created, and the chat route would treat its link as stale.
    const request = ++botsRequest;
    set({ loading: true, error: null });
    try {
      const bots = await botsApi.list();
      if (request !== botsRequest) return;
      set({ bots, loading: false });
    } catch (error) {
      if (request !== botsRequest) return;
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load bots",
      });
    }
  },

  loadModels: async () => {
    try {
      const { models, defaultModel, gatewayConfigured } = await botsApi.models();
      set({ gatewayConfigured, models, defaultModel: defaultModel ?? models[0]?.id });
    } catch {
      // Banner state stays as-is; the chat pane shows its own error.
    }
  },

  togglePin: async (botId) => {
    const current = get().bots.find((bot) => bot.id === botId);
    if (!current) return;
    const pinned = current.pinnedAt === null;
    const setPinnedAt = (pinnedAt: string | null) =>
      set((state) => ({
        bots: state.bots.map((bot) => (bot.id === botId ? { ...bot, pinnedAt } : bot)),
      }));
    setPinnedAt(pinned ? new Date().toISOString() : null);
    try {
      const updated = await botsApi.pin(botId, pinned);
      setPinnedAt(updated.pinnedAt);
    } catch (error) {
      setPinnedAt(current.pinnedAt);
      toast.error(error instanceof Error ? error.message : "Failed to update pin");
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
    set((state) => ({
      bots: state.bots.map((bot) => (bot.id === botId ? { ...bot, unread: false } : bot)),
    }));
    void botsApi.read(botId).catch(() => undefined);
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
        [botId]: s.chats[botId] ?? {
          messages: [],
          busy: false,
          queued: [],
          pending: [],
          connected: false,
          loaded: false,
          unreadFrom: Number.isNaN(unreadFrom) ? null : unreadFrom,
        },
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
                ...(s.chats[botId] ?? {
                  messages: [],
                  busy: false,
                  queued: [],
                  pending: [],
                  connected: false,
                  loaded: false,
                  unreadFrom: null,
                }),
                connected: false,
              },
            },
          }));
          return;
        }
        get().applyChatEvent(botId, typed);
      },
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

  applyChatEvent: (botId, event) => {
    if (event.type === "ping" || event.type === "error") return;
    set((s) => ({
      chats: {
        ...s.chats,
        [botId]: applyEvent(
          s.chats[botId] ?? {
            messages: [],
            busy: false,
            queued: [],
            pending: [],
            connected: false,
            loaded: false,
            unreadFrom: null,
          },
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
