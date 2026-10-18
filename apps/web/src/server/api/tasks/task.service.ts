import { prisma } from "@groot/core/database";
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
  const rows = await prisma.task.findMany({
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
  });
  return rows.map(toApi);
}

export async function create(input: CreateTaskDTO): Promise<TaskRow> {
  const row = await prisma.task.create({
    data: {
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      dueAt: input.dueAt ?? null,
      completedAt: input.status === "done" ? new Date() : null,
    },
  });
  return toApi(row);
}

async function find(id: string) {
  const row = await prisma.task.findUnique({ where: { id } });
  if (!row) throw Boom.notFound("Task not found");
  return row;
}

export async function update(id: string, input: UpdateTaskDTO): Promise<TaskRow> {
  await find(id);
  const row = await prisma.task.update({
    where: { id },
    data: {
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
    },
  });
  return toApi(row);
}

export async function remove(id: string): Promise<void> {
  await find(id);
  await prisma.task.delete({ where: { id } });
}
