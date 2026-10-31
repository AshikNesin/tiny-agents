/**
 * Tasks: the owner's to-dos. One module owns the rules, and two thin
 * adapters sit on it: the HTTP routes (task.routes.ts, the Tasks page) and
 * the agent's task tools (task.store.ts, the `TaskStore` port). Both views
 * share the row mapping, the update rule and the idempotent create, so they
 * never diverge.
 */
import { asc, desc, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { db, tasks } from "../../db";
import type { CreateTaskDTO, TaskPriority, TaskStatus, UpdateTaskDTO } from "./task.schema";

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What creates a task: the page's form or a bot's tool call. */
export interface NewTask {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: Date | null;
  /**
   * Durable tool-call id: a create replayed by pi-durable with the same key
   * returns the task it made the first time instead of a second one.
   */
  sourceKey?: string;
}

/** What may change on a task. `status` carries `completedAt` with it. */
export type TaskPatch = Partial<
  Pick<NewTask, "title" | "description" | "priority" | "dueAt" | "status">
>;

type DbTask = typeof tasks.$inferSelect;

/** DB row → the task as both adapters see it: `sourceKey` is a tool-idempotency detail, not surface. */
function toRow(row: DbTask): TaskRow {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    // Text columns in SQLite; only the DTO unions ever write them.
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listTasks(filter: { status?: TaskStatus } = {}): Promise<TaskRow[]> {
  const rows = await db
    .select()
    .from(tasks)
    .where(filter.status ? eq(tasks.status, filter.status) : undefined)
    .orderBy(asc(tasks.dueAt), desc(tasks.createdAt));
  return rows.map(toRow);
}

export async function findTask(id: string): Promise<TaskRow | undefined> {
  const row = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  return row ? toRow(row) : undefined;
}

export async function createTask(input: NewTask): Promise<TaskRow> {
  if (input.sourceKey) {
    const existing = await db.query.tasks.findFirst({
      where: eq(tasks.sourceKey, input.sourceKey),
    });
    if (existing) return toRow(existing);
  }
  const status = input.status ?? "todo";
  const [row] = await db
    .insert(tasks)
    .values({
      title: input.title,
      description: input.description ?? "",
      status,
      priority: input.priority ?? "medium",
      dueAt: input.dueAt ?? null,
      // "done" always has a completion time (the Completed tab sorts by it).
      completedAt: status === "done" ? new Date() : null,
      ...(input.sourceKey ? { sourceKey: input.sourceKey } : {}),
    })
    .returning();
  return toRow(row!);
}

/** Apply a patch; undefined when the task is gone (each adapter says so its own way). */
export async function updateTask(id: string, patch: TaskPatch): Promise<TaskRow | undefined> {
  const changes = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt ?? null } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    // completedAt follows status so "done" always has a completion time and
    // reopening always clears it — the Completed tab sorts by it.
    ...(patch.status !== undefined
      ? { completedAt: patch.status === "done" ? new Date() : null }
      : {}),
  };
  if (Object.keys(changes).length === 0) return findTask(id);
  const [row] = await db.update(tasks).set(changes).where(eq(tasks.id, id)).returning();
  return row ? toRow(row) : undefined;
}

/** True when a task was removed; false when there was none. */
export async function removeTask(id: string): Promise<boolean> {
  const deleted = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
  return deleted.length > 0;
}

// ── The HTTP adapter's shape: 404s where the page expects them ──────────

export { listTasks as list };
export const create = (input: CreateTaskDTO) => createTask(input);
export async function update(id: string, input: UpdateTaskDTO): Promise<TaskRow> {
  const row = await updateTask(id, input);
  if (!row) throw Boom.notFound("Task not found");
  return row;
}
export async function remove(id: string): Promise<void> {
  if (!(await removeTask(id))) throw Boom.notFound("Task not found");
}
