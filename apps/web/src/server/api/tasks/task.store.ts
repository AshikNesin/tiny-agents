/**
 * TaskStore adapter: the agent's task tools (packages/agent/src/toolkits/tasks)
 * over the tasks module (task.service.ts), which the Tasks page shares.
 * Dependency direction stays one-way: `@tiny-agents/agent` defines the port,
 * apps/web implements it. This file only translates shapes: ISO strings for
 * dates, `undefined` for a missing task.
 */
import type { TaskRecord, TaskStore } from "@tiny-agents/agent";
import { createTask, listTasks, removeTask, updateTask, type TaskRow } from "./task.service";

function toRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export const taskStore: TaskStore = {
  async create(input) {
    return toRecord(
      await createTask({
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        // Exactly-once across pi-durable replays: the key is the durable tool
        // task's identity (unique per agent store, stable when the call reruns).
        sourceKey: input.idempotencyKey,
      }),
    );
  },

  async list(filter) {
    return (await listTasks(filter?.status ? { status: filter.status } : {})).map(toRecord);
  },

  async update(id, input) {
    const row = await updateTask(id, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    // A missing id updates nothing: surface it as a tool error.
    return row ? toRecord(row) : undefined;
  },

  async remove(id) {
    return removeTask(id);
  },
};
