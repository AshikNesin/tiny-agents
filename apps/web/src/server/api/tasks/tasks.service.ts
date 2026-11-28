import { asc, desc, eq, sql } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { db, tasks } from "../../db";
import type { TaskStatus } from "../../../shared/machines/task";
import type { TaskData, TaskPriority } from "../../../shared/api/tasks";
import type { CreateTaskDTO, UpdateTaskDTO } from "./tasks.schema";

export type TaskRow = TaskData;

export interface NewTask {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: Date | null;
  sourceKey?: string;
}

export type TaskPatch = Partial<
  Pick<NewTask, "title" | "description" | "priority" | "dueAt" | "status">
>;

type DbTask = typeof tasks.$inferSelect;

function toRow(row: DbTask): TaskRow {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
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
  const status = input.status ?? "todo";
  const [row] = await db
    .insert(tasks)
    .values({
      title: input.title,
      description: input.description ?? "",
      status,
      priority: input.priority ?? "medium",
      dueAt: input.dueAt ?? null,
      completedAt: status === "done" ? new Date() : null,
      ...(input.sourceKey ? { sourceKey: input.sourceKey } : {}),
    })
    .onConflictDoNothing(input.sourceKey ? { target: tasks.sourceKey } : undefined)
    .returning();
  if (row) return toRow(row);
  if (input.sourceKey) {
    const existing = await db.query.tasks.findFirst({
      where: eq(tasks.sourceKey, input.sourceKey),
    });
    if (existing) return toRow(existing);
  }
  throw new Error("The task could not be created");
}

function completedAtOnMoveTo(status: TaskStatus) {
  if (status !== "done") return null;
  return sql<Date>`CASE WHEN ${tasks.status} = 'done' AND ${tasks.completedAt} IS NOT NULL THEN ${tasks.completedAt} ELSE ${Date.now()} END`;
}

export async function updateTask(id: string, patch: TaskPatch): Promise<TaskRow | undefined> {
  const changes = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt ?? null } : {}),
    ...(patch.status !== undefined
      ? { status: patch.status, completedAt: completedAtOnMoveTo(patch.status) }
      : {}),
  };
  if (Object.keys(changes).length === 0) return findTask(id);
  const [row] = await db.update(tasks).set(changes).where(eq(tasks.id, id)).returning();
  return row ? toRow(row) : undefined;
}

export async function removeTask(id: string): Promise<boolean> {
  const deleted = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
  return deleted.length > 0;
}

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
