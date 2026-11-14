/**
 * App-wide Code state (ADR 0011): the configured harnesses (with their
 * capabilities and connection), and the live merged thread list: one SSE
 * for the whole app, feeding the Code page's list, the sidebar's unread
 * badge and ⌘K. An open thread streams on its own connection (useCodeThread).
 */
import { create } from "zustand";
import { subscribeSse, type SseConnection } from "../lib/sse";
import {
  codeApi,
  type CodeListEvent,
  type HarnessInfo,
  type InstanceStatus,
  type ThreadSummary,
} from "../lib/code/api";

interface CodeState {
  /** null until the status call answered. */
  harnesses: HarnessInfo[] | null;
  statuses: Record<string, InstanceStatus>;
  threads: ThreadSummary[] | null;
  connect(): void;
  disconnect(): void;
  /** Optimistic local edits (seen, archived) until the next list event. */
  patch(threadId: string, change: Partial<ThreadSummary>): void;
}

let connection: SseConnection | undefined;
let refs = 0;

export const useCodeStore = create<CodeState>((set, get) => ({
  harnesses: null,
  statuses: {},
  threads: null,
  connect() {
    refs += 1;
    if (refs > 1) return;
    void codeApi
      .status()
      .then(({ harnesses }) => {
        set({
          harnesses,
          statuses: Object.fromEntries(harnesses.map((h) => [h.id, h.status])),
        });
        if (harnesses.length === 0 || refs === 0 || connection) return;
        connection = subscribeSse(codeApi.eventsPath(), (raw) => {
          const event = raw as CodeListEvent;
          if (event.type === "status") set({ statuses: event.instances });
          else if (event.type === "list") set({ threads: event.threads });
        });
      })
      .catch(() => set({ harnesses: [] }));
  },
  disconnect() {
    refs = Math.max(0, refs - 1);
    if (refs > 0) return;
    connection?.close();
    connection = undefined;
  },
  patch(threadId, change) {
    const rows = get().threads;
    if (!rows) return;
    set({ threads: rows.map((row) => (row.id === threadId ? { ...row, ...change } : row)) });
  },
}));

/** The harness behind a thread or instance id. */
export function harnessOf(
  harnesses: HarnessInfo[] | null,
  instanceId: string | null | undefined,
): HarnessInfo | undefined {
  return harnesses?.find((h) => h.id === instanceId);
}

/** Top-level threads with unread turns (the sidebar badge). */
export function unreadCount(rows: ThreadSummary[] | null): number {
  return (rows ?? []).filter((r) => r.unread && !r.parentId).length;
}
