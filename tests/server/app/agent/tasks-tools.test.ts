/**
 * Task tools: real pi-durable chat turns with a faux model that emits tool
 * calls. Verifies the tools reach the injected TaskStore, the tool result
 * flows back to the model, and a replayed create (same callId) does not
 * duplicate the task.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  createTasksExtension,
  type TaskRecord,
  type TaskStore,
} from "../../../../packages/agent/src/tasks";
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

  it("a replayed create with the same callId stores the task only once", async () => {
    const store = memoryStore();
    const first = await store.create({ idempotencyKey: "call-1", title: "once" });
    const second = await store.create({ idempotencyKey: "call-1", title: "once" });
    expect(second.id).toBe(first.id);
    expect(await store.list()).toHaveLength(1);
  });
});
