/**
 * The Code hub (ADR 0011): the app's one view over every configured
 * harness. It starts each instance, keeps a cached thread list per instance
 * (re-read when the instance says it changed), decorates rows with what
 * tiny-agents tracks (followed, unread), counts who is watching a thread,
 * and relays instance events (turn ends, attention, reconnects) to the
 * watcher that delivers hand-offs and pushes.
 *
 * It never asks which kind of harness an instance is.
 */
import { logger } from "@groot/core/logger";
import {
  LEGACY_INSTANCE_ID,
  parseThreadId,
  threadIdOf,
  type HarnessInstance,
  type InstanceEvent,
  type InstanceStatus,
  type ThreadEvent,
  type ThreadSummary,
} from "@tiny-agents/code/server";
import { seenMap } from "./code.store";
import { app } from "../../app-root";

type HubChange = "list" | "status";

interface HubEvent {
  instance: HarnessInstance;
  event: InstanceEvent;
}

export interface CodeHub {
  start(): void;
  stop(): void;
  instances(): HarnessInstance[];
  instance(instanceId: string): HarnessInstance | undefined;
  /** Resolve a thread id to its instance; legacy bare ids belong to the default Shelley. */
  resolve(threadId: string): { instance: HarnessInstance; nativeId: string } | undefined;
  statuses(): Record<string, InstanceStatus>;
  /** Every instance's active threads, decorated (followed, unread). */
  list(): Promise<ThreadSummary[]>;
  /** Re-read one instance's list now (after a change made here). */
  refresh(instanceId: string): Promise<void>;
  /** Watch one thread; counts as a viewer while open. */
  watch(threadId: string, listener: (event: ThreadEvent) => void): () => void;
  viewers(threadId: string): number;
  onChange(listener: (change: HubChange) => void): () => void;
  onEvent(listener: (event: HubEvent) => void): () => void;
}

export interface HubOptions {
  instances: HarnessInstance[];
  /** List refetch debounce after an instance says its list changed. */
  listDebounceMs?: number;
  /** The instance bare (pre-ADR-0011) thread ids belong to. */
  legacyInstanceId?: string;
}

export function createCodeHub(options: HubOptions): CodeHub {
  const byId = new Map(options.instances.map((i) => [i.id, i]));
  const debounceMs = options.listDebounceMs ?? 300;
  const legacy = options.legacyInstanceId ?? LEGACY_INSTANCE_ID;
  const lists = new Map<string, ThreadSummary[]>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const viewerCounts = new Map<string, number>();
  const changeListeners = new Set<(change: HubChange) => void>();
  const eventListeners = new Set<(event: HubEvent) => void>();
  const unsubscribers: Array<() => void> = [];
  let running = false;

  function emit<T>(listeners: Set<(value: T) => void>, value: T) {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch (error) {
        logger.warn({ error }, "A Code hub listener failed");
      }
    }
  }

  async function readList(instance: HarnessInstance): Promise<void> {
    try {
      lists.set(instance.id, await instance.listThreads("active"));
      emit(changeListeners, "list");
    } catch (error) {
      logger.warn({ error, instance: instance.id }, "Could not read a harness's thread list");
    }
  }

  function scheduleList(instance: HarnessInstance) {
    if (timers.has(instance.id)) return;
    timers.set(
      instance.id,
      setTimeout(() => {
        timers.delete(instance.id);
        void readList(instance);
      }, debounceMs),
    );
  }

  return {
    start() {
      if (running) return;
      running = true;
      for (const instance of byId.values()) {
        unsubscribers.push(
          instance.subscribe((event) => {
            if (event.type === "threads") scheduleList(instance);
            if (event.type === "status") emit(changeListeners, "status");
            if (event.type === "connected") scheduleList(instance);
            emit(eventListeners, { instance, event });
          }),
        );
        try {
          instance.start();
        } catch (error) {
          logger.warn({ error, instance: instance.id }, "A harness did not start");
        }
        void readList(instance);
      }
    },
    stop() {
      running = false;
      for (const off of unsubscribers.splice(0)) off();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const instance of byId.values()) instance.stop();
    },
    instances: () => [...byId.values()],
    instance: (instanceId) => byId.get(instanceId),
    resolve(threadId) {
      // Bare ids are links written before ADR 0011 (`/code/<shelley conversation id>`).
      const parsed = parseThreadId(threadId, legacy);
      const instance = parsed && byId.get(parsed.instanceId);
      return instance ? { instance, nativeId: parsed.nativeId } : undefined;
    },
    statuses() {
      const out: Record<string, InstanceStatus> = {};
      for (const instance of byId.values()) out[instance.id] = instance.status();
      return out;
    },
    async list() {
      const seen = await seenMap();
      const out: ThreadSummary[] = [];
      for (const instance of byId.values()) {
        for (const thread of lists.get(instance.id) ?? []) {
          const last = seen.get(thread.id);
          out.push({
            ...thread,
            followed: last !== undefined,
            unread: last !== undefined && !thread.working && thread.cursor > last,
          });
        }
      }
      return out;
    },
    async refresh(instanceId) {
      const instance = byId.get(instanceId);
      if (instance) await readList(instance);
    },
    watch(threadId, listener) {
      const target = this.resolve(threadId);
      if (!target) {
        listener({ type: "error", message: "No harness serves this thread." });
        return () => {};
      }
      const id = threadIdOf(target.instance.id, target.nativeId);
      viewerCounts.set(id, (viewerCounts.get(id) ?? 0) + 1);
      const stop = target.instance.watchThread(target.nativeId, listener);
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        stop();
        const left = (viewerCounts.get(id) ?? 1) - 1;
        if (left <= 0) viewerCounts.delete(id);
        else viewerCounts.set(id, left);
      };
    },
    viewers: (threadId) => viewerCounts.get(threadId) ?? 0,
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
}

/** The process's hub (`app().codeHub`); undefined until boot (or when no harness is configured). */
export function codeHub(): CodeHub | undefined {
  return app().codeHub;
}

export function setCodeHub(next: CodeHub | undefined): CodeHub | undefined {
  const root = app();
  root.codeHub?.stop();
  root.codeHub = next;
  return next;
}
