import { asc, desc, eq } from "drizzle-orm";
import { db, tasks } from "../../db";
import { Boom } from "@groot/core/errors";
import type { CreateTaskDTO, TaskStatus, UpdateTaskDTO } from "./task.schema";

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: string;
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** DB row → API shape: `sourceKey` is a tool-idempotency detail, not API surface. */
function toApi(row: {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): TaskRow {
  const { id, title, description, status, priority, dueAt, completedAt, createdAt, updatedAt } =
    row;
  return {
    id,
    title,
    description,
    status: assertStatus(status),
    priority,
    dueAt,
    completedAt,
    createdAt,
    updatedAt,
  };
}

function assertStatus(value: string): TaskStatus {
  return value as TaskStatus;
}

/**
 * Tasks are the owner's to-dos (talorys-style): both the Tasks page and the
 * bots' agent tools go through this service so the two views never diverge.
 */
export async function list(): Promise<TaskRow[]> {
  const rows = await db.select().from(tasks).orderBy(asc(tasks.dueAt), desc(tasks.createdAt));
  return rows.map(toApi);
}

export async function create(input: CreateTaskDTO): Promise<TaskRow> {
  const [row] = await db
    .insert(tasks)
    .values({
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      dueAt: input.dueAt ?? null,
      completedAt: input.status === "done" ? new Date() : null,
    })
    .returning();
  return toApi(row!);
}

async function find(id: string) {
  const row = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  if (!row) throw Boom.notFound("Task not found");
  return row;
}

export async function update(id: string, input: UpdateTaskDTO): Promise<TaskRow> {
  await find(id);
  const [row] = await db
    .update(tasks)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt ?? null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      // completedAt follows status so "done" always has a completion time and
      // reopening always clears it — the Completed tab sorts by it.
      ...(input.status !== undefined
        ? { completedAt: input.status === "done" ? new Date() : null }
        : {}),
    })
    .where(eq(tasks.id, id))
    .returning();
  return toApi(row!);
}

export async function remove(id: string): Promise<void> {
  await find(id);
  await db.delete(tasks).where(eq(tasks.id, id));
}
