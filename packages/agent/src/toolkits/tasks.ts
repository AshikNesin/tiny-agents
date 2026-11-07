/**
 * Task tools: the durable bridge between bots and the app's task list.
 *
 * The app injects a `TaskStore` (an adapter over its own database) when it
 * opens the runtime; the tools below run inside pi-durable with
 * `replay: "safe"`, so a call interrupted by a restart re-executes on
 * recovery. Exactly-once is the store's job: `create` takes an idempotency
 * key (a unique column), so a replayed create returns the existing row
 * instead of duplicating it.
 *
 * The key is the durable tool task's identity, not the model's tool call id:
 * `callId` comes from the provider and is only unique within one assistant
 * message — OpenAI-compatible upstreams may send short ids ("call_0") or none
 * at all (pi-ai stores ""), which would collide across turns and bots. The
 * tool task id is what re-executes on replay, but it is a per-store counter,
 * so it is salted with the conversation's persisted UUIDv7 (`pi.provider`):
 * a fresh agent.db next to an old app.db must never hit old rows.
 */
import { defineExtension, defineTool, ProviderDoc } from "@earendil-works/pi-durable";
import type { Extension, ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import type { Capability } from "../capabilities";

type TaskStatus = "todo" | "in_progress" | "done";
type TaskPriority = "low" | "medium" | "high" | "urgent";

/** The task as tools see and return it (ISO date strings). */
export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
}

/** What the app provides: CRUD over its task table. */
export interface TaskStore {
  /** `idempotencyKey` (the durable tool task's identity) makes replays return the same row. */
  create(input: {
    idempotencyKey: string;
    title: string;
    description?: string;
    priority?: TaskPriority;
    dueAt?: string | null;
  }): Promise<TaskRecord>;
  list(filter?: { status?: TaskStatus }): Promise<TaskRecord[]>;
  update(
    id: string,
    input: {
      title?: string;
      description?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      dueAt?: string | null;
    },
  ): Promise<TaskRecord | undefined>;
  remove(id: string): Promise<boolean>;
}

const titleSchema = Type.String({ minLength: 1, maxLength: 300 });
const prioritySchema = Type.Unsafe<TaskPriority>({
  type: "string",
  enum: ["low", "medium", "high", "urgent"],
});
const statusSchema = Type.Unsafe<TaskStatus>({
  type: "string",
  enum: ["todo", "in_progress", "done"],
});
const isoDateSchema = Type.Unsafe<string>({
  type: "string",
  format: "date-time",
});

/** Compact task line for the model. */
function present(t: TaskRecord): string {
  const bits = [t.title];
  if (t.dueAt) bits.push(`due ${t.dueAt.slice(0, 16).replace("T", " ")}`);
  bits.push(t.priority, t.status);
  if (t.description) bits.push(`— ${t.description.slice(0, 120)}`);
  return `[${t.id}] ${bits.join(" · ")}`;
}

const ok = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
});
const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

/** Replay-stable, store-independent idempotency key for a tool call's side effect (see header). */
export async function toolIdempotencyKey(api: ToolExecutionApi, context: Context): Promise<string> {
  const provider = await api.snapshot(ProviderDoc, api.conversationId, context);
  return `pi:${provider?.sessionId ?? `conversation-${api.conversationId}`}:${api.taskId}`;
}

/**
 * The "tasks" extension: task tools. `store` is the app-side
 * adapter over its task table (see apps/web bots.runtime.ts). The tools are
 * created per extension so they close over the store.
 */
export function createTasksExtension(store: TaskStore): Extension {
  const createTask = defineTool({
    name: "create_task",
    description:
      "Create a task (to-do) for the owner. Use for action items the owner mentions. Returns the task with its id.",
    parameters: Type.Object({
      title: titleSchema,
      description: Type.Optional(Type.String({ maxLength: 2000 })),
      priority: Type.Optional(prioritySchema),
      dueAt: Type.Optional(
        Type.Unsafe<string>({
          type: "string",
          format: "date-time",
          description: "ISO 8601 datetime; omit for no due date",
        }),
      ),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const idempotencyKey = await toolIdempotencyKey(api, context);
      const task = await store.create({ idempotencyKey, ...args });
      return ok(`Created task ${present(task)}`);
    },
  });

  const listTasks = defineTool({
    name: "list_tasks",
    description:
      "List the owner's tasks. Filter by status ('todo', 'in_progress', 'done'); default: open tasks.",
    parameters: Type.Object({ status: Type.Optional(statusSchema) }),
    replay: "safe",
    execute: async (args) => {
      const tasks = await store.list(args.status ? { status: args.status } : undefined);
      return ok(tasks.length === 0 ? "No tasks." : tasks.map(present).join("\n"));
    },
  });

  const updateTask = defineTool({
    name: "update_task",
    description:
      "Update a task by id: title, notes, status, priority or due date. 'done' marks it complete.",
    parameters: Type.Object({
      id: Type.String(),
      title: Type.Optional(titleSchema),
      description: Type.Optional(Type.String({ maxLength: 2000 })),
      status: Type.Optional(statusSchema),
      priority: Type.Optional(prioritySchema),
      dueAt: Type.Optional(Type.Union([isoDateSchema, Type.Null()])),
    }),
    replay: "safe",
    execute: async (args) => {
      const { id, ...input } = args;
      const task = await store.update(id, input);
      return task ? ok(`Updated task ${present(task)}`) : fail(`No task with id "${id}".`);
    },
  });

  const completeTask = defineTool({
    name: "complete_task",
    description: "Mark a task done by id.",
    parameters: Type.Object({ id: Type.String() }),
    replay: "safe",
    execute: async (args) => {
      const task = await store.update(args.id, { status: "done" });
      return task ? ok(`Completed "${task.title}".`) : fail(`No task with id "${args.id}".`);
    },
  });

  const report = (id: string, removed: boolean) =>
    removed ? ok(`Deleted task ${id}.`) : fail(`No task with id "${id}".`);
  const deleteTask = defineTool({
    name: "delete_task",
    description:
      "Permanently delete a task by id. Use only when the owner clearly asks; prefer complete_task.",
    parameters: Type.Object({ id: Type.String() }),
    replay: "safe",
    execute: async (args, api, context) => {
      // Deletes are naturally idempotent, but a rerun after a crash would find
      // the row already gone and tell the model "no task" for a delete that
      // succeeded. Durable memos (per tool task) remember that an attempt
      // started and how it ended, so the rerun reports the real outcome.
      const outcome = await api.memo<boolean>("delete_task:removed", context);
      if (outcome === undefined) {
        const resumed = (await api.memo<boolean>("delete_task:started", context)) === true;
        await api.memo("delete_task:started", true, context);
        const removed = (await store.remove(args.id)) || resumed;
        return report(args.id, await api.memo("delete_task:removed", removed, context));
      }
      return report(args.id, outcome);
    },
  });

  return defineExtension({
    name: "tasks",
    tools: [createTask, listTasks, updateTask, completeTask, deleteTask],
  });
}

/** The `tasks` toolkit: the owner's task list (`apps/web` Tasks page). */
export function createTasksToolkit(store: TaskStore): Capability {
  return {
    id: "tasks",
    kind: "toolkit",
    name: "Tasks",
    description: "Create and manage your tasks",
    extension: createTasksExtension(store),
    tools: [
      {
        name: "create_task",
        label: "Added task",
        askLabel: "add a task",
        description: "Create a task",
      },
      {
        name: "list_tasks",
        label: "Listed tasks",
        askLabel: "list tasks",
        description: "List tasks",
        readOnly: true,
      },
      {
        name: "update_task",
        label: "Updated task",
        askLabel: "update a task",
        description: "Update a task",
      },
      {
        name: "complete_task",
        label: "Completed task",
        askLabel: "complete a task",
        description: "Mark a task done",
      },
      {
        name: "delete_task",
        label: "Deleted task",
        askLabel: "delete a task",
        description: "Delete a task",
      },
    ],
  };
}
