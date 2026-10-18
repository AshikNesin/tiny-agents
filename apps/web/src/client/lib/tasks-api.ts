import { apiClient } from "@groot/shell/lib/api";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskInput = Partial<Pick<Task, "title" | "description" | "status" | "priority">> & {
  dueAt?: string | null;
};

export const tasksApi = {
  list: () => apiClient.get<Task[]>("/tasks"),
  create: (input: { title: string } & Partial<TaskInput>) => apiClient.post<Task>("/tasks", input),
  update: (id: string, input: TaskInput) => apiClient.patch<Task>(`/tasks/${id}`, input),
  remove: (id: string) => apiClient.delete<{ deleted: boolean }>(`/tasks/${id}`),
};
