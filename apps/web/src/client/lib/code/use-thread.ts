/**
 * One Code thread, live (ADR 0011). The thread's stream starts with a full
 * snapshot (the harness reads the history after its live feed is open, so
 * nothing falls between) and then upserts rows by id; every reconnect starts
 * from a fresh snapshot.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeSse } from "../sse";
import {
  codeApi,
  type BackgroundJob,
  type CodeThreadEvent,
  type QueuedMessage,
  type ThreadSettings,
  type ThreadSnapshot,
  type ThreadSummary,
  type TranscriptItem,
} from "./api";

export interface ThreadState {
  loaded: boolean;
  error: string | null;
  thread: ThreadSummary | null;
  items: TranscriptItem[];
  settings: ThreadSettings | null;
  queued: QueuedMessage[];
  jobs: BackgroundJob[];
  children: ThreadSummary[];
  working: boolean;
  context: { used: number; max?: number };
  costUsd: number;
  /** Text the model is streaming right now (not yet a row). */
  partialText: string;
  partialThinking: string;
  cursor: number;
  reload(): Promise<void>;
  /** Apply a settings change the server confirmed. */
  setSettings(settings: ThreadSettings): void;
}

interface Data {
  thread: ThreadSummary | null;
  order: string[];
  byId: Map<string, TranscriptItem>;
  settings: ThreadSettings | null;
  queued: QueuedMessage[];
  jobs: BackgroundJob[];
  children: ThreadSummary[];
  working: boolean;
  context: { used: number; max?: number };
  costUsd: number;
  partialText: string;
  partialThinking: string;
  cursor: number;
}

const EMPTY: Data = {
  thread: null,
  order: [],
  byId: new Map(),
  settings: null,
  queued: [],
  jobs: [],
  children: [],
  working: false,
  context: { used: 0 },
  costUsd: 0,
  partialText: "",
  partialThinking: "",
  cursor: 0,
};

function fromSnapshot(snapshot: ThreadSnapshot): Data {
  return {
    thread: snapshot.thread,
    order: snapshot.items.map((i) => i.id),
    byId: new Map(snapshot.items.map((i) => [i.id, i])),
    settings: snapshot.settings,
    queued: snapshot.queued,
    jobs: snapshot.jobs,
    children: snapshot.children,
    working: snapshot.thread.working,
    context: snapshot.context,
    costUsd: snapshot.costUsd,
    partialText: "",
    partialThinking: "",
    cursor: snapshot.thread.cursor,
  };
}

/** Apply one thread event (pure, for tests). */
export function applyThreadEvent(data: Data, event: CodeThreadEvent): Data {
  switch (event.type) {
    case "snapshot":
      return fromSnapshot(event.snapshot);
    case "items": {
      const byId = new Map(data.byId);
      const order = [...data.order];
      for (const item of event.items) {
        if (!byId.has(item.id)) order.push(item.id);
        byId.set(item.id, item);
      }
      // A finished message replaces the streaming tail.
      const done = event.items.some((i) => i.kind === "assistant" || i.kind === "turn");
      return {
        ...data,
        byId,
        order,
        cursor: Math.max(data.cursor, event.cursor),
        ...(done ? { partialText: "", partialThinking: "" } : {}),
      };
    }
    case "thread":
      return { ...data, thread: event.thread, cursor: Math.max(data.cursor, event.thread.cursor) };
    case "partial":
      return { ...data, partialText: event.text, partialThinking: event.thinking };
    case "state":
      return {
        ...data,
        working: event.working,
        ...(event.context ? { context: event.context } : {}),
        ...(event.queued ? { queued: event.queued } : {}),
        ...(event.jobs ? { jobs: event.jobs } : {}),
        ...(event.settings ? { settings: event.settings } : {}),
        ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
        ...(event.working ? {} : { partialText: "", partialThinking: "" }),
        thread: data.thread ? { ...data.thread, working: event.working } : data.thread,
      };
    default:
      return data;
  }
}

export function useCodeThread(id: string): ThreadState {
  const [data, setData] = useState<Data>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(id);
  current.current = id;

  const reload = useCallback(async () => {
    const forId = id;
    try {
      const snapshot = await codeApi.get(forId);
      if (current.current !== forId) return;
      setData(fromSnapshot(snapshot));
      setError(null);
    } catch (err) {
      if (current.current === forId) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (current.current === forId) setLoaded(true);
    }
  }, [id]);

  useEffect(() => {
    setData(EMPTY);
    setLoaded(false);
    setError(null);
    const connection = subscribeSse(codeApi.threadEventsPath(id), (raw) => {
      const event = raw as CodeThreadEvent | { type: "error"; message: string };
      if (event.type === "error") {
        setError(event.message);
        return;
      }
      if (event.type === "snapshot") {
        setLoaded(true);
        setError(null);
      }
      setData((prev) => applyThreadEvent(prev, event));
    });
    return () => connection.close();
  }, [id]);

  const setSettings = useCallback(
    (settings: ThreadSettings) => setData((prev) => ({ ...prev, settings })),
    [],
  );

  return {
    loaded,
    error,
    thread: data.thread,
    items: data.order.map((key) => data.byId.get(key)!).filter(Boolean),
    settings: data.settings,
    queued: data.queued,
    jobs: data.jobs,
    children: data.children,
    working: data.working,
    context: data.context,
    costUsd: data.costUsd,
    partialText: data.partialText,
    partialThinking: data.partialThinking,
    cursor: data.cursor,
    reload,
    setSettings,
  };
}
