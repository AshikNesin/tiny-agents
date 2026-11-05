/**
 * `@tiny-agents/code/testing`: what driver tests share — an in-memory
 * thread index, a quiet host, and the contract check every driver must pass
 * (a capability is on exactly when its method exists).
 */
import type {
  Capabilities,
  HarnessHost,
  HarnessInstance,
  IndexedThread,
  ThreadEvent,
  ThreadIndex,
} from "./contracts";

export function memoryIndex(): ThreadIndex & { rows: Map<string, IndexedThread> } {
  const rows = new Map<string, IndexedThread>();
  const key = (instanceId: string, nativeId: string) => `${instanceId}:${nativeId}`;
  return {
    rows,
    async list(instanceId) {
      return [...rows.values()].filter((row) => row.instanceId === instanceId);
    },
    async get(instanceId, nativeId) {
      return rows.get(key(instanceId, nativeId));
    },
    async upsert(input) {
      const existing = rows.get(key(input.instanceId, input.nativeId));
      const now = new Date();
      const row: IndexedThread = {
        title: "",
        cwd: null,
        parentNativeId: null,
        model: null,
        effort: null,
        permissionMode: null,
        archived: false,
        createdAt: now,
        data: {},
        ...existing,
        ...input,
        updatedAt: input.updatedAt ?? now,
      };
      rows.set(key(row.instanceId, row.nativeId), row);
      return row;
    },
    async remove(instanceId, nativeId) {
      rows.delete(key(instanceId, nativeId));
    },
  };
}

export function testHost(overrides: Partial<HarnessHost> = {}): HarnessHost & {
  logs: Array<{ level: string; message: string; fields?: Record<string, unknown> }>;
} {
  const logs: Array<{ level: string; message: string; fields?: Record<string, unknown> }> = [];
  const log = (level: string) => (message: string, fields?: Record<string, unknown>) => {
    logs.push({ level, message, fields });
  };
  return {
    logs,
    logger: { info: log("info"), warn: log("warn"), error: log("error") },
    index: memoryIndex(),
    now: () => new Date(),
    ...overrides,
  };
}

/** Optional methods each capability needs. */
const REQUIRED: Array<[(c: Capabilities) => boolean, Array<keyof HarnessInstance>]> = [
  [(c) => c.turns.manageQueue, ["queued"]],
  [(c) => c.turns.recovery.length > 0, ["recover"]],
  [(c) => c.threads.fork, ["fork"]],
  [(c) => c.threads.archive, ["archive"]],
  [(c) => c.threads.delete, ["remove"]],
  [(c) => c.threads.rename, ["rename"]],
  [(c) => c.threads.changeCwd, ["changeCwd"]],
  [(c) => c.threads.search, ["searchThreads"]],
  [(c) => c.settings.modelSwitch || c.settings.permissionModes.length > 0, ["updateSettings"]],
  [(c) => c.approvals.tools || c.approvals.questions, ["respond"]],
  [(c) => c.workspace.diffs, ["diffs", "diffFiles", "fileDiff"]],
  [(c) => c.workspace.findFiles, ["findFiles"]],
  [(c) => c.workspace.uploads, ["upload", "asset"]],
  [(c) => c.workspace.skills, ["skills"]],
  [(c) => c.workspace.browse, ["browse", "validateCwd"]],
  [(c) => c.workspace.worktrees, ["createWorktree"]],
  [(c) => c.extras.jobs, ["killJob"]],
  [(c) => c.extras.usageReport, ["usage"]],
  [(c) => c.extras.commands, ["commands"]],
];

/**
 * Problems with a driver's honesty: a capability on without its method.
 * Empty when the driver is consistent.
 */
export function capabilityProblems(instance: HarnessInstance): string[] {
  const caps = instance.capabilities();
  const problems: string[] = [];
  for (const [on, methods] of REQUIRED) {
    if (!on(caps)) continue;
    for (const method of methods) {
      if (typeof instance[method] !== "function") {
        problems.push(`capability needs ${String(method)}() but the driver has none`);
      }
    }
  }
  if (
    caps.settings.defaultPermissionMode &&
    !caps.settings.permissionModes.includes(caps.settings.defaultPermissionMode)
  ) {
    problems.push("defaultPermissionMode is not one of permissionModes");
  }
  return problems;
}

/** Collect a watcher's events; `next()` waits for the next one. */
export function collect(): {
  events: ThreadEvent[];
  listener: (event: ThreadEvent) => void;
  next: (predicate?: (event: ThreadEvent) => boolean, timeoutMs?: number) => Promise<ThreadEvent>;
} {
  const events: ThreadEvent[] = [];
  const waiters: Array<{
    predicate: (event: ThreadEvent) => boolean;
    resolve: (event: ThreadEvent) => void;
  }> = [];
  let read = 0;
  return {
    events,
    listener(event) {
      events.push(event);
      // A copy: matching waiters are removed while iterating.
      // eslint-disable-next-line unicorn/no-useless-spread
      for (const waiter of [...waiters]) {
        if (waiter.predicate(event)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(event);
        }
      }
    },
    next(predicate = () => true, timeoutMs = 2000) {
      for (; read < events.length; read++) {
        const event = events[read]!;
        if (predicate(event)) {
          read++;
          return Promise.resolve(event);
        }
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no matching event")), timeoutMs);
        waiters.push({
          predicate,
          resolve: (event) => {
            clearTimeout(timer);
            read = events.length;
            resolve(event);
          },
        });
      });
    },
  };
}
