import type {
  Capabilities,
  HarnessHost,
  HarnessInstance,
  IndexedThread,
  ThreadEvent,
  ThreadIndex,
  ThreadSnapshot,
  TurnOutcome,
} from "./contracts";
import { turnAnswer } from "./server/outcome";

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

export function threadEventProblems(events: readonly ThreadEvent[]): string[] {
  const problems: string[] = [];
  const at = (i: number, event: ThreadEvent) => `event ${i} (${event.type})`;
  let rows: Map<string, string> | undefined;
  let streaming = false;
  let owed: number | undefined;
  events.forEach((event, i) => {
    if (owed !== undefined) {
      if (event.type !== "partial") {
        problems.push(
          `${at(owed, events[owed]!)} dropped the streaming text without re-sending it`,
        );
      }
      owed = undefined;
    }
    if (event.type === "error") return;
    if (!rows && event.type !== "snapshot") {
      problems.push(`${at(i, event)} came before the first snapshot`);
      return;
    }
    switch (event.type) {
      case "snapshot": {
        rows = new Map();
        for (const item of event.snapshot.items) {
          if (rows.has(item.id)) problems.push(`${at(i, event)} has row ${item.id} twice`);
          rows.set(item.id, JSON.stringify(item));
        }
        if (!event.snapshot.thread.working) streaming = false;
        if (streaming) owed = i;
        break;
      }
      case "items": {
        if (event.items.length === 0) problems.push(`${at(i, event)} is empty`);
        const seen = new Set<string>();
        for (const item of event.items) {
          if (seen.has(item.id)) problems.push(`${at(i, event)} has row ${item.id} twice`);
          seen.add(item.id);
          const json = JSON.stringify(item);
          if (rows!.get(item.id) === json) {
            problems.push(`${at(i, event)} re-sent row ${item.id} unchanged`);
          }
          rows!.set(item.id, json);
          if (item.kind === "assistant" || item.kind === "turn") streaming = false;
        }
        break;
      }
      case "partial":
        streaming = Boolean(event.text || event.thinking);
        break;
      case "state":
        if (!event.working) streaming = false;
        break;
    }
  });
  if (owed !== undefined) {
    problems.push(`${at(owed, events[owed]!)} dropped the streaming text without re-sending it`);
  }
  return problems;
}

interface ShownTurn {
  thread: ThreadSnapshot["thread"];
  answer: ReturnType<typeof turnAnswer>;
}

function sameAsThread(key: "working" | "title" | "cwd" | "cursor") {
  return (outcome: TurnOutcome, { thread }: ShownTurn) =>
    outcome[key] === thread[key]
      ? undefined
      : `${key} is ${JSON.stringify(outcome[key])}, the thread's is ${JSON.stringify(thread[key])}`;
}

const OUTCOME_FIELDS: {
  [K in keyof TurnOutcome]-?: (outcome: TurnOutcome, shown: ShownTurn) => string | undefined;
} = {
  working: sameAsThread("working"),
  title: sameAsThread("title"),
  cwd: sameAsThread("cwd"),
  cursor: sameAsThread("cursor"),
  text: (outcome, { answer }) =>
    outcome.text === answer.text
      ? undefined
      : `text is ${JSON.stringify(outcome.text)}, the rule answers ${JSON.stringify(answer.text)}`,
  failed: (outcome, { answer }) =>
    outcome.failed === answer.failed
      ? undefined
      : `failed is ${outcome.failed}, the rule answers ${answer.failed}`,
  endedAt: ({ endedAt, working, text }) => {
    if (endedAt === undefined) {
      return !working && text ? "endedAt is missing for an answered turn" : undefined;
    }
    if (!Number.isFinite(endedAt)) return "endedAt is not a time";
    return working ? "endedAt is set while the thread works" : undefined;
  },
};

export function turnOutcomeProblems(
  snapshot: Pick<ThreadSnapshot, "thread" | "items">,
  outcome: TurnOutcome,
  ended?: TurnOutcome,
): string[] {
  const shown = { thread: snapshot.thread, answer: turnAnswer(snapshot.items) };
  const problems: string[] = [];
  for (const check of Object.values(OUTCOME_FIELDS)) {
    const problem = check(outcome, shown);
    if (problem) problems.push(problem);
  }
  const unknown = Object.keys(outcome).filter((key) => !Object.hasOwn(OUTCOME_FIELDS, key));
  if (unknown.length > 0) {
    problems.push(`outcome has fields the rule does not answer: ${unknown.join(", ")}`);
  }
  if (ended) {
    const keys = new Set([...Object.keys(ended), ...Object.keys(outcome)]);
    for (const key of keys as Set<keyof TurnOutcome>) {
      if (ended[key] !== outcome[key]) {
        problems.push(
          `turn_ended said ${key} ${JSON.stringify(ended[key])} but outcome() answers ${JSON.stringify(outcome[key])}`,
        );
      }
    }
  }
  return problems;
}

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
