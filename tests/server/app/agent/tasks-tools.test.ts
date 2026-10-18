/**
 * Task tools: real pi-durable chat turns with a faux model that emits tool
 * calls. Verifies the tools reach the injected TaskStore, the tool result
 * flows back to the model, a create interrupted by a restart replays without
 * duplicating the task, and creates are never keyed on provider call ids.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  createTasksExtension,
  type TaskRecord,
  type TaskStore,
} from "../../../../packages/agent/src/toolkits/tasks";
import {
  openTestRuntime,
  TEST_MODEL,
  fauxToolCall,
  fauxText,
  fauxAssistantMessage,
} from "../../../../packages/agent/src/testing";
import type { ChatEvent, ChatState } from "../../../../packages/agent/src/types";

interface MemoryStore extends TaskStore {
  calls: string[];
}

function memoryStore(): MemoryStore {
  const rows = new Map<string, TaskRecord & { sourceKeyRef?: string }>();
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    async create(input) {
      calls.push(`create:${input.title}`);
      for (const row of rows.values()) {
        if (row.sourceKeyRef === input.idempotencyKey) return row;
      }
      const row = {
        id: `t${++n}`,
        title: input.title,
        description: input.description ?? "",
        status: "todo" as const,
        priority: input.priority ?? ("medium" as const),
        dueAt: input.dueAt ?? null,
        completedAt: null,
        sourceKeyRef: input.idempotencyKey,
      };
      rows.set(row.id, row);
      return row;
    },
    async list(filter) {
      calls.push(`list:${filter?.status ?? "open"}`);
      return [...rows.values()].filter((r) => (filter?.status ? r.status === filter.status : true));
    },
    async update(id, input) {
      calls.push(`update:${id}`);
      const row = rows.get(id);
      if (!row) return undefined;
      Object.assign(row, input);
      if (input.status === "done") row.completedAt = new Date().toISOString();
      else if (input.status) row.completedAt = null;
      return row;
    },
    async remove(id) {
      calls.push(`remove:${id}`);
      return rows.delete(id);
    },
  };
}

function withStopReason(message: ReturnType<typeof fauxAssistantMessage>) {
  const hasToolCall = message.content.some((b) => b.type === "toolCall");
  return hasToolCall && message.stopReason !== "toolUse"
    ? { ...message, stopReason: "toolUse" as const }
    : message;
}

async function settled(store: MemoryStore, replies0: ReturnType<typeof fauxAssistantMessage>[]) {
  const replies = replies0.map(withStopReason);
  const events: ChatEvent[] = [];
  const runtime = await openTestRuntime({
    storePath: ":memory:",
    extensions: [createTasksExtension(store)],
    respondWith: (() => {
      const queue = [...replies];
      return () => (queue.length > 1 ? queue.shift()! : queue[0]);
    })(),
  });
  const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
  const sub = await runtime.watchChat(ref, (batch) => events.push(...batch));
  await runtime.submit(ref, { requestId: "r1", text: "please" });

  const deadline = Date.now() + 10_000;
  let state: ChatState | undefined;
  while (Date.now() < deadline) {
    state = reduce(events);
    if (state && !state.busy && state.messages.some((m) => m.role === "assistant" && m.text)) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  await sub.stop();
  await runtime.close();
  return { state: state!, events };
}

function reduce(events: ChatEvent[]): ChatState | undefined {
  let state: ChatState | undefined;
  for (const event of events) {
    if (event.type === "snapshot") state = structuredClone(event.state);
    else if (state) {
      if (event.type === "upsert") {
        const i = state.messages.findIndex((m) => m.id === event.message.id);
        if (i >= 0) state.messages[i] = event.message;
        else state.messages.push(event.message);
      } else if (event.type === "busy") {
        state.busy = event.busy;
      }
    }
  }
  return state;
}

describe("task tools (durable chat turns)", () => {
  it("create_task reaches the store and the tool result flows back to the model", async () => {
    const store = memoryStore();
    const { state } = await settled(store, [
      fauxAssistantMessage([
        fauxToolCall("create_task", { title: "Ship the tasks feature", priority: "high" }),
      ]),
      fauxAssistantMessage([fauxText("Task created as t1")]),
    ]);

    expect(store.calls).toContain("create:Ship the tasks feature");
    // The follow-up reply (after the tool result) made it into the transcript.
    expect(
      state.messages.some((m) => m.role === "assistant" && m.text.includes("Task created")),
    ).toBe(true);
  }, 15_000);

  it("list_tasks filters by status through the same store", async () => {
    const store = memoryStore();
    await store.create({ idempotencyKey: "k1", title: "One" });
    const { state } = await settled(store, [
      fauxAssistantMessage([fauxToolCall("list_tasks", {})]),
      fauxAssistantMessage([fauxText("You have one open task")]),
    ]);
    expect(store.calls).toContain("list:open");
    expect(state.messages.some((m) => m.text.includes("one open task"))).toBe(true);
  }, 15_000);

  it("a replayed create with the same key stores the task only once", async () => {
    const store = memoryStore();
    const first = await store.create({ idempotencyKey: "call-1", title: "once" });
    const second = await store.create({ idempotencyKey: "call-1", title: "once" });
    expect(second.id).toBe(first.id);
    expect(await store.list()).toHaveLength(1);
  });

  it("does not key creates on the provider's tool call id (reused or empty ids)", async () => {
    // OpenAI-compatible upstreams may reuse short ids ("call_0") or send none;
    // two different creates with the same callId must stay two tasks.
    const store = memoryStore();
    await settled(store, [
      fauxAssistantMessage([fauxToolCall("create_task", { title: "First" }, { id: "call_0" })]),
      fauxAssistantMessage([fauxToolCall("create_task", { title: "Second" }, { id: "call_0" })]),
      fauxAssistantMessage([fauxText("Created both")]),
    ]);
    await settled(store, [
      fauxAssistantMessage([fauxToolCall("create_task", { title: "Other bot" }, { id: "" })]),
      fauxAssistantMessage([fauxText("Created it")]),
    ]);
    expect((await store.list()).map((task) => task.title).sort()).toEqual([
      "First",
      "Other bot",
      "Second",
    ]);
  }, 30_000);

  it("re-executes an interrupted create after a restart without duplicating it", async () => {
    const store = memoryStore();
    const reply = await interruptAndResume(store, "create", {
      name: "create_task",
      args: { title: "Exactly once" },
    });
    // The replay-safe tool ran again on resume, and the store deduped it.
    expect(store.calls.filter((call) => call === "create:Exactly once")).toHaveLength(2);
    expect(await store.list()).toHaveLength(1);
    expect(reply).toMatch(/^Created task \[t1\] Exactly once/);
  }, 30_000);

  it("reports an interrupted delete as done when its rerun finds the row gone", async () => {
    const store = memoryStore();
    await store.create({ idempotencyKey: "seed", title: "Doomed" });
    const reply = await interruptAndResume(store, "remove", {
      name: "delete_task",
      args: { id: "t1" },
    });
    expect(store.calls.filter((call) => call === "remove:t1")).toHaveLength(2);
    expect(await store.list()).toHaveLength(0);
    expect(reply).toBe("Deleted task t1.");
  }, 30_000);
});

/**
 * Run one tool call whose store method performs its effect and then "dies"
 * (the runtime closes before the result commits), reopen the same agent
 * store, and return the tool result text the resumed run fed the model.
 */
async function interruptAndResume(
  store: MemoryStore,
  method: "create" | "remove",
  call: { name: string; args: Record<string, unknown> },
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "tiny-agents-tool-replay-"));
  const storePath = join(directory, "agent.db");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let interrupt = true;
  let effects = 0;
  const flaky: MemoryStore = {
    ...store,
    create: async (input) => {
      const row = await store.create(input);
      effects++;
      if (interrupt && method === "create") {
        interrupt = false;
        await gate;
        throw new Error("process died mid-call");
      }
      return row;
    },
    remove: async (id) => {
      const removed = await store.remove(id);
      effects++;
      if (interrupt && method === "remove") {
        interrupt = false;
        await gate;
        throw new Error("process died mid-call");
      }
      return removed;
    },
  };
  try {
    const first = await openTestRuntime({
      storePath,
      extensions: [createTasksExtension(flaky)],
      respondWith: () => withStopReason(fauxAssistantMessage([fauxToolCall(call.name, call.args)])),
    });
    const ref = await first.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
    await first.submit(ref, { requestId: "r1", text: "do it" });
    const deadline = Date.now() + 10_000;
    while (effects === 0) {
      if (Date.now() > deadline) throw new Error(`${call.name} never ran`);
      await new Promise((r) => setTimeout(r, 20));
    }
    // Close while the tool is mid-call: its result is never committed.
    const closing = first.close();
    await new Promise((r) => setTimeout(r, 50));
    release();
    await closing;

    // The resumed run's model echoes the tool result it was given.
    const second = await openTestRuntime({
      storePath,
      extensions: [createTasksExtension(flaky)],
      respondWith: (context) => {
        const result = [...context.messages].reverse().find((m) => m.role === "toolResult");
        const text =
          result && Array.isArray(result.content)
            ? result.content.map((b) => (b.type === "text" ? b.text : "")).join("")
            : "";
        return fauxAssistantMessage([fauxText(`RESULT:${text}`)]);
      },
    });
    try {
      const events: ChatEvent[] = [];
      const sub = await second.watchChat(ref, (batch) => events.push(...batch));
      const until = Date.now() + 10_000;
      const done = () => {
        const state = reduce(events);
        return state && !state.busy
          ? state.messages.find((m) => m.text.startsWith("RESULT:"))
          : undefined;
      };
      while (!done()) {
        if (Date.now() > until) throw new Error("resumed run never finished");
        await new Promise((r) => setTimeout(r, 25));
      }
      await sub.stop();
      return done()!.text.slice("RESULT:".length);
    } finally {
      await second.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
