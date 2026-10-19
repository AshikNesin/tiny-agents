/**
 * Typed client for the routines API (issue #18, PRD 5.7). Mirrors the server's
 * response shapes; `apiClient` unwraps the { success, data } envelope.
 */
import { apiClient } from "@groot/shell/lib/api";

/** The schedule union as it travels on the wire (PRD 5.1). */
export type Schedule =
  | { kind: "once"; at: string }
  | { kind: "cron"; expr: string }
  | { kind: "interval"; minutes: number };

export interface Routine {
  id: string;
  botId: string;
  botName: string;
  name: string;
  prompt: string;
  schedule: Schedule;
  scheduleDescription: string;
  enabled: boolean;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Create/patch responses add the pre-rendered next fire times (PRD 5.2). */
export type RoutineWithPreview = Routine & { nextFireTimes: string[] };

export type RoutineInput = {
  botId?: string;
  name?: string;
  prompt?: string;
  schedule?: Schedule;
  enabled?: boolean;
};

export interface RoutineRun {
  id: string;
  routineId: string;
  /** Present on recentRuns rows; absent from per-routine runs. */
  routineName?: string;
  botName?: string;
  scheduledFor: string;
  status: "awaiting" | "succeeded" | "failed" | "missed" | "cancelled";
  trigger: "schedule" | "manual";
  submittedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  output: string | null;
  error: string | null;
}

export const routinesApi = {
  list: () => apiClient.get<Routine[]>("/routines"),
  create: (
    input: RoutineInput & Pick<Routine, "botId" | "name" | "prompt"> & { schedule: Schedule },
  ) => apiClient.post<RoutineWithPreview>("/routines", input),
  update: (id: string, input: RoutineInput) =>
    apiClient.patch<RoutineWithPreview>(`/routines/${id}`, input),
  remove: (id: string) => apiClient.delete<{ deleted: boolean }>(`/routines/${id}`),
  pause: (id: string) => apiClient.post<Routine>(`/routines/${id}/pause`),
  resume: (id: string) => apiClient.post<Routine>(`/routines/${id}/resume`),
  runNow: (id: string) => apiClient.post<{ runId: string }>(`/routines/${id}/run`),
  listRuns: (id: string, limit = 20) =>
    apiClient.get<{ runs: RoutineRun[] }>(`/routines/${id}/runs`, { limit }),
  recentRuns: (limit = 20) =>
    apiClient.get<{ runs: RoutineRun[] }>("/routines/runs/recent", { limit }),
};
