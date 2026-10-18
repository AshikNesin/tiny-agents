/**
 * Task tools: the durable bridge between bots and the app's task list.
 *
 * The app injects a `TaskStore` (an adapter over its own database) when it
 * opens the runtime; the tools below run inside pi-durable with
 * `replay: "safe"`, so a call interrupted by a restart re-executes on
 * recovery. Exactly-once is the store's job: `create` takes the tool call's
 * `callId` as an idempotency key (a unique column), so a replayed create
 * returns the existing row instead of duplicating it.
 */
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { Extension, ToolExecutionResult } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

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
  /** `idempotencyKey` (the tool call id) makes replays return the same row. */
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

/**
 * The "tasks" extension: task tools every bot gets. `store` is the app-side
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
    execute: async (args, api) => {
      const task = await store.create({ idempotencyKey: api.callId, ...args });
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

  const deleteTask = defineTool({
    name: "delete_task",
    description:
      "Permanently delete a task by id. Use only when the owner clearly asks; prefer complete_task.",
    parameters: Type.Object({ id: Type.String() }),
    replay: "safe",
    execute: async (args) => {
      const removed = await store.remove(args.id);
      return removed ? ok(`Deleted task ${args.id}.`) : fail(`No task with id "${args.id}".`);
    },
  });

  return defineExtension({
    name: "tasks",
    tools: [createTask, listTasks, updateTask, completeTask, deleteTask],
  });
}
