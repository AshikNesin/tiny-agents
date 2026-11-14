/** The Tasks API's wire types (`server/api/tasks`); naming in `./common.ts`. */
import type { Jsonified } from "../json";
import type { TaskStatus } from "../machines/task";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

/** A task as every `/tasks` route returns it (`task.service.ts`). */
export interface TaskData {
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

export type Task = Jsonified<TaskData>;

/** `PATCH /tasks/:id`: at least one field. */
export interface TaskUpdateBody {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: string | null;
}

/** `POST /tasks`. */
export type TaskCreateBody = TaskUpdateBody & { title: string };
