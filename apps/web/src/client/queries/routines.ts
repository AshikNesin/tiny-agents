/** The Routines page's resource: the routines with the recent runs, and their writes (`lib/routines-api.ts`). */
import { useMutation } from "@tanstack/react-query";
import type {
  Routine,
  RoutineCreateBody,
  RoutineRun,
  RoutineUpdateBody,
} from "../../shared/api/routines";
import { routinesApi } from "../lib/routines-api";
import { RESOURCE_MUTATION, useResource } from "./resource";

/** How many recent runs the page lists. */
const RECENT_RUNS = 10;

/** The routines and the recent runs, fetched together so they land together. */
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

/**
 * The routine writes. None refetches: the page does after each, at the point
 * it always did (before a card's toast, once the editor has closed).
 */
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
