/**
 * TaskStore adapter: gives the agent's task tools (packages/agent/src/toolkits/tasks)
 * CRUD access to app.db's task table. Dependency direction stays one-way —
 * `@tiny-agents/agent` defines the port, apps/web implements it.
 */
import { asc, desc, eq } from "drizzle-orm";
import { db, tasks } from "../../db";
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
      ? await db.query.tasks.findFirst({ where: eq(tasks.sourceKey, input.idempotencyKey) })
      : undefined;
    if (existing) return toRecord(existing);
    const [row] = await db
      .insert(tasks)
      .values({
        title: input.title,
        description: input.description ?? "",
        priority: input.priority ?? "medium",
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        ...(input.idempotencyKey ? { sourceKey: input.idempotencyKey } : {}),
      })
      .returning();
    return toRecord(row!);
  },

  async list(filter) {
    const rows = await db
      .select()
      .from(tasks)
      .where(filter?.status ? eq(tasks.status, filter.status) : undefined)
      .orderBy(asc(tasks.dueAt), desc(tasks.createdAt));
    return rows.map(toRecord);
  },

  async update(id, input) {
    const [row] = await db
      .update(tasks)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.status !== undefined
          ? { completedAt: input.status === "done" ? new Date() : null }
          : {}),
      })
      .where(eq(tasks.id, id))
      .returning();
    // A missing id updates nothing: surface it as a tool error.
    return row ? toRecord(row) : undefined;
  },

  async remove(id) {
    const deleted = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
    return deleted.length > 0;
  },
};
