/**
 * TaskStore adapter: gives the agent's task tools (packages/agent/src/toolkits/tasks)
 * CRUD access to app.db's task table. Dependency direction stays one-way —
 * `@tiny-agents/agent` defines the port, apps/web implements it.
 */
import { prisma } from "@groot/core/database";
import type { TaskPriority, TaskRecord, TaskStatus, TaskStore } from "@tiny-agents/agent";

function toRecord(row: {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueAt: Date | null;
  completedAt: Date | null;
}): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export const taskStore: TaskStore = {
  async create(input) {
    // Exactly-once across pi-durable replays: the key is the durable tool
    // task's identity (unique per agent store, stable when the call reruns).
    const existing = input.idempotencyKey
      ? await prisma.task.findUnique({ where: { sourceKey: input.idempotencyKey } })
      : null;
    if (existing) return toRecord(existing);
    const row = await prisma.task.create({
      data: {
        title: input.title,
        description: input.description ?? "",
        priority: input.priority ?? "medium",
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        ...(input.idempotencyKey ? { sourceKey: input.idempotencyKey } : {}),
      },
    });
    return toRecord(row);
  },

  async list(filter) {
    const rows = await prisma.task.findMany({
      where: filter?.status ? { status: filter.status } : undefined,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    });
    return rows.map(toRecord);
  },

  async update(id, input) {
    try {
      const row = await prisma.task.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.dueAt !== undefined
            ? { dueAt: input.dueAt ? new Date(input.dueAt) : null }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.status !== undefined
            ? { completedAt: input.status === "done" ? new Date() : null }
            : {}),
        },
      });
      return toRecord(row);
    } catch {
      return undefined; // update on a missing id (P2025) — surface as tool error
    }
  },

  async remove(id) {
    const deleted = await prisma.task.deleteMany({ where: { id } });
    return deleted.count > 0;
  },
};
