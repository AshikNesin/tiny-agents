import type { Jsonified } from "../json";
import type { TaskStatus } from "../machines/task";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

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

export interface TaskUpdateBody {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: string | null;
}

export type TaskCreateBody = TaskUpdateBody & { title: string };
