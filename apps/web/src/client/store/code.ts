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
  harnesses: HarnessInfo[] | null;
  statuses: Record<string, InstanceStatus>;
  threads: ThreadSummary[] | null;
  connect(): void;
  disconnect(): void;
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
      .catch((error: unknown) => {
        console.error("Could not load the Code harnesses; Code stays hidden until reload", error);
        set({ harnesses: [] });
      });
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

export function harnessOf(
  harnesses: HarnessInfo[] | null,
  instanceId: string | null | undefined,
): HarnessInfo | undefined {
  return harnesses?.find((h) => h.id === instanceId);
}

export function unreadCount(rows: ThreadSummary[] | null): number {
  return (rows ?? []).filter((r) => r.unread && !r.parentId).length;
}
