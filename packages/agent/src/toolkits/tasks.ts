import { ProviderDoc } from "@earendil-works/pi-durable";
import type { Extension, ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { z } from "zod";
import type { Capability } from "../capabilities";
import { durableMemo } from "../durable-json";
import { defineToolkit, tool } from "../toolkit";

type TaskStatus = "todo" | "in_progress" | "done";
type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
}

export interface TaskStore {
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

const startedMemo = durableMemo("delete_task:started", z.boolean());
const removedMemo = durableMemo("delete_task:removed", z.boolean());

export async function toolIdempotencyKey(api: ToolExecutionApi, context: Context): Promise<string> {
  const provider = await api.snapshot(ProviderDoc, api.conversationId, context);
  return `pi:${provider?.sessionId ?? `conversation-${api.conversationId}`}:${api.taskId}`;
}

export function createTasksToolkit(store: TaskStore): Capability {
  const createTask = tool({
    name: "create_task",
    label: "Added task",
    askLabel: "add a task",
    summary: "Create a task",
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

  const listTasks = tool({
    name: "list_tasks",
    label: "Listed tasks",
    askLabel: "list tasks",
    summary: "List tasks",
    description:
      "List the owner's tasks. Filter by status ('todo', 'in_progress', 'done'); default: open tasks.",
    policy: { readOnly: true },
    parameters: Type.Object({ status: Type.Optional(statusSchema) }),
    replay: "safe",
    execute: async (args) => {
      const tasks = await store.list(args.status ? { status: args.status } : undefined);
      return ok(tasks.length === 0 ? "No tasks." : tasks.map(present).join("\n"));
    },
  });

  const updateTask = tool({
    name: "update_task",
    label: "Updated task",
    askLabel: "update a task",
    summary: "Update a task",
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

  const completeTask = tool({
    name: "complete_task",
    label: "Completed task",
    askLabel: "complete a task",
    summary: "Mark a task done",
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
  const deleteTask = tool({
    name: "delete_task",
    label: "Deleted task",
    askLabel: "delete a task",
    summary: "Delete a task",
    description:
      "Permanently delete a task by id. Use only when the owner clearly asks; prefer complete_task.",
    parameters: Type.Object({ id: Type.String() }),
    replay: "safe",
    execute: async (args, api, context) => {
      const outcome = await removedMemo.read(api, context);
      if (outcome === undefined) {
        const resumed = (await startedMemo.read(api, context)) === true;
        await startedMemo.keep(api, true, context);
        const removed = (await store.remove(args.id)) || resumed;
        return report(args.id, await removedMemo.keep(api, removed, context));
      }
      return report(args.id, outcome);
    },
  });

  return defineToolkit({
    id: "tasks",
    name: "Tasks",
    description: "Create and manage your tasks",
    tools: [createTask, listTasks, updateTask, completeTask, deleteTask],
  });
}

export function createTasksExtension(store: TaskStore): Extension {
  return createTasksToolkit(store).extension;
}
