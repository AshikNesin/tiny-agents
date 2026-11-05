/**
 * An in-memory harness for app-layer tests: the hub, the watcher and the
 * routes must work with any `HarnessInstance`, so they are tested against
 * one that is neither Shelley nor Claude Code. Tests drive its events and
 * outcome directly.
 */
import {
  NO_CAPABILITIES,
  threadIdOf,
  type Capabilities,
  type HarnessInstance,
  type InstanceEvent,
  type ThreadEvent,
  type ThreadSummary,
  type TurnOutcome,
} from "@tiny-agents/code/contracts";

export interface FakeHarness extends HarnessInstance {
  threads: ThreadSummary[];
  outcomes: Map<string, TurnOutcome>;
  sent: Array<{ nativeId: string; message: string; queue?: boolean }>;
  created: Array<Record<string, unknown>>;
  emit(event: InstanceEvent): void;
  push(nativeId: string, event: ThreadEvent): void;
}

export function fakeHarness(id = "fake", capabilities: Partial<Capabilities> = {}): FakeHarness {
  const listeners = new Set<(event: InstanceEvent) => void>();
  const watchers = new Map<string, Set<(event: ThreadEvent) => void>>();
  let created = 0;
  const thread = (nativeId: string, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
    id: threadIdOf(id, nativeId),
    instanceId: id,
    kind: "fake",
    nativeId,
    title: nativeId,
    cwd: "/repo",
    model: null,
    parentId: null,
    createdAt: "2026-11-05T00:00:00Z",
    updatedAt: "2026-11-05T00:00:00Z",
    working: false,
    archived: false,
    cursor: 0,
    ...extra,
  });
  const harness: FakeHarness = {
    id,
    kind: "fake",
    label: "Fake",
    threads: [],
    outcomes: new Map(),
    sent: [],
    created: [],
    capabilities: () => ({ ...NO_CAPABILITIES, ...capabilities }),
    start: () => harness.emit({ type: "connected" }),
    stop: () => {},
    status: () => ({ state: "connected" }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    push(nativeId, event) {
      for (const listener of watchers.get(nativeId) ?? []) listener(event);
    },
    async listThreads() {
      return harness.threads;
    },
    async getThread(nativeId) {
      return {
        thread: harness.threads.find((t) => t.nativeId === nativeId) ?? thread(nativeId),
        items: [],
        settings: { model: null, effort: null, permissionMode: null },
        queued: [],
        jobs: [],
        children: [],
        context: { used: 0 },
        costUsd: 0,
      };
    },
    watchThread(nativeId, listener) {
      let set = watchers.get(nativeId);
      if (!set) watchers.set(nativeId, (set = new Set()));
      set.add(listener);
      void harness.getThread(nativeId).then((snapshot) => listener({ type: "snapshot", snapshot }));
      return () => set.delete(listener);
    },
    async outcome(nativeId) {
      return (
        harness.outcomes.get(nativeId) ?? {
          working: false,
          title: nativeId,
          cwd: "/repo",
          text: "Done.",
          failed: false,
          endedAt: Date.now() + 1000,
          cursor: 1,
        }
      );
    },
    async createThread(input) {
      created += 1;
      harness.created.push({ ...input });
      const nativeId = `t${created}`;
      harness.threads.push(thread(nativeId, { cwd: input.cwd ?? null }));
      return { nativeId };
    },
    async send(nativeId, input) {
      harness.sent.push({ nativeId, message: input.message, queue: input.queue });
      return { status: input.queue ? "queued" : "accepted" };
    },
    async interrupt() {},
    async models() {
      return [{ id: "m1", label: "Model One", isDefault: true }];
    },
  };
  return harness;
}
