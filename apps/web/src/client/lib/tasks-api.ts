import { apiClient } from "@groot/shell/lib/api";
import type { Deleted } from "../../shared/api/common";
import type { Task, TaskCreateBody, TaskUpdateBody } from "../../shared/api/tasks";

export const tasksApi = {
  list: () => apiClient.get<Task[]>("/tasks"),
  create: (input: TaskCreateBody) => apiClient.post<Task>("/tasks", input),
  update: (id: string, input: TaskUpdateBody) => apiClient.patch<Task>(`/tasks/${id}`, input),
  remove: (id: string) => apiClient.delete<Deleted>(`/tasks/${id}`),
};
