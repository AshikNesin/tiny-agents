import { logger } from "@groot/core/logger";
import {
  type HarnessInstance,
  type InstanceEvent,
  type InstanceStatus,
  type ThreadEvent,
  type ThreadSummary,
} from "@tiny-agents/code/server";
import { onReviewTurnEnded } from "./code.findings";
import {
  eventWithThreadKeys,
  listProjectThreads,
  recordThreadEvent,
  threadKey,
  threadRef,
} from "./code.threads";
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
  resolve(threadId: string): { instance: HarnessInstance; nativeId: string } | undefined;
  statuses(): Record<string, InstanceStatus>;
  list(): Promise<ThreadSummary[]>;
  refresh(instanceId: string): Promise<void>;
  watch(threadId: string, listener: (event: ThreadEvent) => void): () => void;
  viewers(threadId: string): number;
  serial<T>(key: string, work: () => Promise<T>): Promise<T>;
  onChange(listener: (change: HubChange) => void): () => void;
  listChanged(): void;
  onEvent(listener: (event: HubEvent) => void): () => void;
  handedOff(threadId: string): void;
  onHandoff(listener: (threadId: string) => void): () => void;
}

export interface HubOptions {
  instances: HarnessInstance[];
  listDebounceMs?: number;
}

const queueMovesOnAfterAFailureItsCallerSees = (): undefined => undefined;

export function createCodeHub(options: HubOptions): CodeHub {
  const byId = new Map(options.instances.map((i) => [i.id, i]));
  const debounceMs = options.listDebounceMs ?? 300;
  const lists = new Map<string, ThreadSummary[]>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const viewerCounts = new Map<string, number>();
  const queues = new Map<string, Promise<unknown>>();
  const changeListeners = new Set<(change: HubChange) => void>();
  const eventListeners = new Set<(event: HubEvent) => void>();
  const handoffListeners = new Set<(threadId: string) => void>();
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

  const hub: CodeHub = {
    start() {
      if (running) return;
      running = true;
      for (const instance of byId.values()) {
        unsubscribers.push(
          instance.subscribe((event) => {
            if (event.type === "threads") scheduleList(instance);
            if (event.type === "status") emit(changeListeners, "status");
            if (event.type === "connected") scheduleList(instance);
            void recordThreadEvent(instance.id, event)
              .then((changed) => changed && emit(changeListeners, "list"))
              .then(() =>
                event.type === "turn_ended" && !event.outcome.working
                  ? onReviewTurnEnded(hub, threadKey(instance.id, event.nativeId))
                  : false,
              )
              .catch((error: unknown) =>
                logger.warn({ error, instance: instance.id }, "A thread event was not recorded"),
              )
              .finally(() => emit(eventListeners, { instance, event }));
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
      const ref = threadRef(threadId);
      const instance = ref && byId.get(ref.instanceId);
      return instance ? { instance, nativeId: ref.nativeId } : undefined;
    },
    statuses() {
      const out: Record<string, InstanceStatus> = {};
      for (const instance of byId.values()) out[instance.id] = instance.status();
      return out;
    },
    list() {
      return listProjectThreads({
        kindOf: (instanceId) => byId.get(instanceId)?.kind,
        active: (instanceId) => lists.get(instanceId),
      });
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
      const id = threadKey(target.instance.id, target.nativeId);
      viewerCounts.set(id, (viewerCounts.get(id) ?? 0) + 1);
      const stop = target.instance.watchThread(target.nativeId, (event) =>
        listener(eventWithThreadKeys(event)),
      );
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
    serial(key, work) {
      const next = (queues.get(key) ?? Promise.resolve()).then(work);
      const settled = next.then(() => undefined, queueMovesOnAfterAFailureItsCallerSees);
      queues.set(key, settled);
      void settled.then(() => {
        if (queues.get(key) === settled) queues.delete(key);
      });
      return next;
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    listChanged() {
      emit(changeListeners, "list");
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    handedOff(threadId) {
      emit(handoffListeners, threadId);
    },
    onHandoff(listener) {
      handoffListeners.add(listener);
      return () => handoffListeners.delete(listener);
    },
  };
  return hub;
}

export function codeHub(): CodeHub | undefined {
  return app().codeHub;
}

export function setCodeHub(next: CodeHub | undefined): CodeHub | undefined {
  const root = app();
  root.codeHub?.stop();
  root.codeHub = next;
  return next;
}
