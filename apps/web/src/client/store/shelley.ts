/**
 * App-wide Shelley state (issue #143): whether Shelley is configured, the
 * hub's connection, and the live conversation list — one SSE for the whole
 * app, feeding the Code page's list, the sidebar's unread badge and ⌘K.
 * The open conversation streams on its own connection (useShelleyConversation).
 */
import { create } from "zustand";
import { subscribeSse, type SseConnection } from "../lib/sse";
import {
  shelleyApi,
  type HubConnection,
  type ShelleyConversation,
  type ShelleyEvent,
} from "../lib/shelley/api";

interface ShelleyState {
  /** null until the status call answered. */
  configured: boolean | null;
  publicUrl: string | null;
  connection: HubConnection;
  conversations: ShelleyConversation[] | null;
  connect(): void;
  disconnect(): void;
  /** Optimistic local edits (seen, archived) until the next list event. */
  patch(conversationId: string, change: Partial<ShelleyConversation>): void;
}

let connection: SseConnection | undefined;
let refs = 0;

export const useShelleyStore = create<ShelleyState>((set, get) => ({
  configured: null,
  publicUrl: null,
  connection: { state: "disabled" },
  conversations: null,
  connect() {
    refs += 1;
    if (refs > 1) return;
    void shelleyApi
      .status()
      .then((status) => {
        set({
          configured: status.configured,
          publicUrl: status.publicUrl,
          connection: status.connection,
        });
        if (!status.configured || refs === 0 || connection) return;
        connection = subscribeSse(shelleyApi.eventsPath(), (raw) => {
          const event = raw as ShelleyEvent;
          if (event.type === "status") set({ connection: event.connection });
          else if (event.type === "list") set({ conversations: event.conversations });
        });
      })
      .catch(() => set({ configured: false }));
  },
  disconnect() {
    refs = Math.max(0, refs - 1);
    if (refs > 0) return;
    connection?.close();
    connection = undefined;
  },
  patch(conversationId, change) {
    const rows = get().conversations;
    if (!rows) return;
    set({
      conversations: rows.map((row) =>
        row.conversation_id === conversationId ? { ...row, ...change } : row,
      ),
    });
  },
}));

/** Top-level conversations with unread turns (the sidebar badge). */
export function unreadCount(rows: ShelleyConversation[] | null): number {
  return (rows ?? []).filter((r) => r.unread && !r.parent_conversation_id).length;
}
