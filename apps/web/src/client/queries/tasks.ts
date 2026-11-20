import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Task, TaskCreateBody, TaskUpdateBody } from "../../shared/api/tasks";
import { tasksApi } from "../lib/tasks-api";
import { RESOURCE_MUTATION, useResource } from "./resource";

const TASKS_KEY = ["tasks", "list"] as const;

export const useTasks = () => useResource(TASKS_KEY, () => tasksApi.list(), "Failed to load tasks");

export function useSetTask() {
  const client = useQueryClient();
  return (id: string, patch: Partial<Task>) =>
    client.setQueryData<Task[]>(TASKS_KEY, (tasks) =>
      tasks?.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    );
}

export function useTaskMutations() {
  const create = useMutation({
    mutationFn: (input: TaskCreateBody) => tasksApi.create(input),
    ...RESOURCE_MUTATION,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskUpdateBody }) =>
      tasksApi.update(id, input),
    ...RESOURCE_MUTATION,
  });
  const remove = useMutation({
    mutationFn: (id: string) => tasksApi.remove(id),
    ...RESOURCE_MUTATION,
  });
  return { create, update, remove };
}
