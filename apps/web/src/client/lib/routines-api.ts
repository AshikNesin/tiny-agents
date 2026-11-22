import { apiClient } from "@groot/shell/lib/api";
import type { Deleted } from "../../shared/api/common";
import type {
  Routine,
  RoutineCreateBody,
  RoutineHook,
  RoutineRuns,
  RoutineRunStarted,
  RoutineUpdateBody,
  RoutineWithPreview,
} from "../../shared/api/routines";

export const routinesApi = {
  list: () => apiClient.get<Routine[]>("/routines"),
  create: (input: RoutineCreateBody) => apiClient.post<RoutineWithPreview>("/routines", input),
  update: (id: string, input: RoutineUpdateBody) =>
    apiClient.patch<RoutineWithPreview>(`/routines/${id}`, input),
  remove: (id: string) => apiClient.delete<Deleted>(`/routines/${id}`),
  pause: (id: string) => apiClient.post<Routine>(`/routines/${id}/pause`),
  resume: (id: string) => apiClient.post<Routine>(`/routines/${id}/resume`),
  runNow: (id: string) => apiClient.post<RoutineRunStarted>(`/routines/${id}/run`),
  rotateHook: (id: string) => apiClient.post<RoutineHook>(`/routines/${id}/hook`),
  listRuns: (id: string, limit = 20) =>
    apiClient.get<RoutineRuns>(`/routines/${id}/runs`, { limit }),
  recentRuns: (limit = 20) => apiClient.get<RoutineRuns>("/routines/runs/recent", { limit }),
};
