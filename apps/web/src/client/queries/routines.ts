import { useMutation } from "@tanstack/react-query";
import type {
  Routine,
  RoutineCreateBody,
  RoutineRun,
  RoutineUpdateBody,
} from "../../shared/api/routines";
import { routinesApi } from "../lib/routines-api";
import { RESOURCE_MUTATION, useResource } from "./resource";

const RECENT_RUNS = 10;

export const useRoutines = () =>
  useResource(
    ["routines", "page"],
    async (): Promise<{ routines: Routine[]; runs: RoutineRun[] }> => {
      const [routines, recent] = await Promise.all([
        routinesApi.list(),
        routinesApi.recentRuns(RECENT_RUNS),
      ]);
      return { routines, runs: recent.runs };
    },
    "Failed to load routines",
  );

export function useRoutineMutations() {
  const create = useMutation({
    mutationFn: (input: RoutineCreateBody) => routinesApi.create(input),
    ...RESOURCE_MUTATION,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: RoutineUpdateBody }) =>
      routinesApi.update(id, input),
    ...RESOURCE_MUTATION,
  });
  const remove = useMutation({
    mutationFn: (id: string) => routinesApi.remove(id),
    ...RESOURCE_MUTATION,
  });
  const resume = useMutation({
    mutationFn: (id: string) => routinesApi.resume(id),
    ...RESOURCE_MUTATION,
  });
  const runNow = useMutation({
    mutationFn: (id: string) => routinesApi.runNow(id),
    ...RESOURCE_MUTATION,
  });
  return { create, update, remove, resume, runNow };
}
