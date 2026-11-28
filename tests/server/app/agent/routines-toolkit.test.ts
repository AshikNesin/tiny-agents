import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ProviderDoc, type ProviderState } from "@earendil-works/pi-durable";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import { defaultPermission } from "../../../../packages/agent/src/wire";
import {
  createRoutinesToolkit,
  type RoutineRecord,
  type RoutineStore,
} from "../../../../packages/agent/src/toolkits/routines";

interface MemoryStore extends RoutineStore {
  calls: string[];
  rows: Map<string, RoutineRecord>;
  nextError: Error | undefined;
}

function record(overrides: Partial<RoutineRecord> = {}): RoutineRecord {
  return {
    id: "r1",
    name: "weekday-digest",
    prompt: "Summarize HN.",
    schedule: { kind: "cron", expr: "0 9 * * 1-5" },
    enabled: true,
    sentence: "At 09:00, Monday through Friday",
    nextFireTimes: [
      "Wed, 21 Oct 2026, 09:00 IST",
      "Thu, 22 Oct 2026, 09:00 IST",
      "Fri, 23 Oct 2026, 09:00 IST",
    ],
    nextRunAt: "2026-10-21T03:30:00.000Z",
    ...overrides,
  };
}

function memoryStore(): MemoryStore {
  const rows = new Map<string, RoutineRecord>();
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    rows,
    nextError: undefined,
    async create(_conversationId, input) {
      calls.push(`create:${input.name}`);
      if (this.nextError) throw this.nextError;
      for (const row of rows.values()) if (row.id === `r${input.idempotencyKey}`) return row;
      const row = record({
        id: `r${input.idempotencyKey}`,
        name: input.name,
        prompt: input.prompt,
        schedule: input.schedule,
      });
      rows.set(row.id, row);
      void n;
      return row;
    },
    async list() {
      calls.push("list");
      if (this.nextError) throw this.nextError;
      return [...rows.values()];
    },
    async update(_conversationId, id, input) {
      calls.push(`update:${id}`);
      if (this.nextError) throw this.nextError;
      const row = rows.get(id);
      if (!row) return undefined;
      return Object.assign(row, input);
    },
    async remove(_conversationId, id) {
      calls.push(`remove:${id}`);
      if (this.nextError) throw this.nextError;
      return rows.delete(id);
    },
    async runNow(_conversationId, id) {
      calls.push(`runNow:${id}`);
      if (this.nextError) throw this.nextError;
      if (!rows.has(id)) throw new Error(`No routine with id "${id}".`);
      return { runId: `run-${++n}` };
    },
    async saveProgress(_conversationId, text) {
      calls.push(`saveProgress:${text}`);
      return true;
    },
  };
}

function api(overrides: Partial<ToolExecutionApi> = {}): ToolExecutionApi {
  const memos = new Map<string, unknown>();
  const base = {
    taskId: 7,
    conversationId: 3,
    callId: "call_0",
    async snapshot(token: typeof ProviderDoc, conversationId: number) {
      return token === ProviderDoc && conversationId === 3
        ? ({ sessionId: "sess-abc" } satisfies ProviderState)
        : undefined;
    },
    async memo(name: string, ...rest: unknown[]) {
      if (rest.length <= 1) return memos.get(name);
      if (!memos.has(name)) memos.set(name, rest[0]);
      return memos.get(name);
    },
  } as unknown as ToolExecutionApi;
  return Object.assign(base, overrides);
}

async function run(
  capability: Capability,
  name: string,
  args: Record<string, unknown>,
  apiOverride?: ToolExecutionApi,
) {
  const tool = capability.extension.tools!.find((t) => t.name === name)!;
  const result = (await tool.execute(
    args as never,
    apiOverride ?? api(),
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  return { ...result, text };
}

describe("routines toolkit", () => {
  it("turns 'in N minutes' into a one-time instant, so the bot needs no clock", async () => {
    const store = memoryStore();
    const now = () => new Date("2026-10-23T10:00:00.000Z");
    const routines = createRoutinesToolkit(store, { now });
    await run(routines, "create_routine", {
      name: "stretch",
      prompt: "Remind me to stretch.",
      schedule: { kind: "in", minutes: 30 },
    });
    const [created] = [...store.rows.values()];
    expect(created!.schedule).toEqual({ kind: "once", at: "2026-10-23T10:30:00.000Z" });

    await run(routines, "update_routine", {
      id: created!.id,
      schedule: { kind: "in", minutes: 90 },
    });
    expect(created!.schedule).toEqual({ kind: "once", at: "2026-10-23T11:30:00.000Z" });
    await run(routines, "update_routine", { id: created!.id, name: "stretch break" });
    expect(created!.schedule).toEqual({ kind: "once", at: "2026-10-23T11:30:00.000Z" });
  });

  it("create_routine keys on the durable tool task and echoes the confirmation card", async () => {
    const store = memoryStore();
    const routines = createRoutinesToolkit(store);
    const result = await run(routines, "create_routine", {
      name: "weekday-digest",
      prompt: "Summarize HN.",
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
    });
    expect(result.isError).toBeUndefined();
    expect(store.calls).toEqual(["create:weekday-digest"]);
    expect([...store.rows.keys()]).toEqual(["rpi:sess-abc:7"]);
    expect(result.text).toContain("Created routine");
    expect(result.text).toContain("At 09:00, Monday through Friday");
    expect(result.text).toContain("Wed, 21 Oct 2026, 09:00 IST");
    expect(result.text).toContain("Summarize HN.");
  });

  it("surfaces store failures as tool errors with the reason", async () => {
    const store = memoryStore();
    store.nextError = new Error(
      "This turn is routine-fired: a scheduled routine run cannot create or manage routines.",
    );
    const routines = createRoutinesToolkit(store);
    const result = await run(routines, "create_routine", {
      name: "loop",
      prompt: "more",
      schedule: { kind: "interval", minutes: 15 },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("routine-fired");
  });

  it("validation failures from the store read as plain reasons", async () => {
    const store = memoryStore();
    store.nextError = new Error("Invalid schedule. schedule.expr: Not a valid cron expression");
    const routines = createRoutinesToolkit(store);
    const result = await run(routines, "create_routine", {
      name: "bad",
      prompt: "x",
      schedule: { kind: "cron", expr: "61 9 * * *" },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Not a valid cron expression");
  });

  it("list_routines lists with sentence, next run, and paused marker", async () => {
    const store = memoryStore();
    store.rows.set("r1", record());
    store.rows.set(
      "r2",
      record({
        id: "r2",
        name: "friday-review",
        enabled: false,
        sentence: "At 18:00, only on Friday",
        nextFireTimes: [],
        nextRunAt: null,
      }),
    );
    const routines = createRoutinesToolkit(store);
    const result = await run(routines, "list_routines", {});
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("[r1] weekday-digest: At 09:00, Monday through Friday");
    expect(result.text).toContain("Wed, 21 Oct 2026, 09:00 IST");
    expect(result.text).toContain("[r2] friday-review (paused): At 18:00, only on Friday");
    expect(result.text).toContain("no next run (paused)");
  });

  it("list_routines with nothing reports none", async () => {
    const routines = createRoutinesToolkit(memoryStore());
    expect((await run(routines, "list_routines", {})).text).toBe("No routines.");
  });

  it("update_routine is partial and echoes the updated card", async () => {
    const store = memoryStore();
    store.rows.set("r1", record());
    const routines = createRoutinesToolkit(store);
    const result = await run(routines, "update_routine", { id: "r1", enabled: false });
    expect(result.isError).toBeUndefined();
    expect(store.calls).toEqual(["update:r1"]);
    expect(store.rows.get("r1")?.enabled).toBe(false);
    expect(result.text).toContain("Updated routine");
    expect(result.text).toContain("(paused)");
  });

  it("update_routine on a missing id is a tool error", async () => {
    const routines = createRoutinesToolkit(memoryStore());
    const result = await run(routines, "update_routine", { id: "nope", name: "x" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No routine with id "nope"');
  });

  it("delete_routine reports removed once and reports missing ids as errors", async () => {
    const store = memoryStore();
    store.rows.set("r1", record());
    const routines = createRoutinesToolkit(store);
    expect((await run(routines, "delete_routine", { id: "r1" })).text).toBe("Deleted routine r1.");
    const missing = await run(routines, "delete_routine", { id: "r1" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe('No routine with id "r1".');
  });

  it("a delete rerun after a crash reports the real outcome from the memos", async () => {
    const store = memoryStore();
    store.rows.set("r1", record());
    let died = false;
    const flaky: MemoryStore = {
      ...store,
      remove: async (conversationId, id) => {
        if (!died) {
          died = true;
          store.rows.delete(id);
          throw new Error("process died mid-call");
        }
        return store.remove(conversationId, id);
      },
    };
    const routines = createRoutinesToolkit(flaky);
    const taskApi = api();
    const crashed = await run(routines, "delete_routine", { id: "r1" }, taskApi);
    expect(crashed.isError).toBe(true);
    const replay = await run(routines, "delete_routine", { id: "r1" }, taskApi);
    expect(replay.isError).toBeUndefined();
    expect(replay.text).toBe("Deleted routine r1.");
    const fresh = await run(routines, "delete_routine", { id: "r1" });
    expect(fresh.isError).toBe(true);
    expect(fresh.text).toBe('No routine with id "r1".');
  });

  it("run_routine_now returns the run id", async () => {
    const store = memoryStore();
    store.rows.set("r1", record());
    const routines = createRoutinesToolkit(store);
    const result = await run(routines, "run_routine_now", { id: "r1" });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("run run-1");
  });

  it("permission defaults: list allow, mutations ask", () => {
    const routines = createRoutinesToolkit(memoryStore());
    const byName = new Map(routines.tools.map((tool) => [tool.name, tool]));
    expect(defaultPermission(byName.get("list_routines")!)).toBe("allow");
    for (const name of ["create_routine", "update_routine", "delete_routine", "run_routine_now"]) {
      expect(defaultPermission(byName.get(name)!)).toBe("ask");
    }
  });

  it("every tool is replay-safe", () => {
    const routines = createRoutinesToolkit(memoryStore());
    expect(routines.extension.tools!.every((tool) => tool.replay === "safe")).toBe(true);
  });
});
