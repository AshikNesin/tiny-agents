import type { Jsonified } from "../json";
import type { RoutineRunStatus } from "../machines/routine-run";

export type Schedule =
  | { kind: "once"; at: string }
  | { kind: "cron"; expr: string }
  | { kind: "interval"; minutes: number };

export interface RoutineData {
  id: string;
  botId: string;
  botName: string;
  name: string;
  prompt: string;
  schedule: Schedule;
  scheduleDescription: string;
  enabled: boolean;
  nextRunAt: Date | null;
  done: boolean;
  blockedStreak: number;
  pausedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type Routine = Jsonified<RoutineData>;

export type RoutineWithPreviewData = RoutineData & { nextFireTimes: string[] };
export type RoutineWithPreview = Jsonified<RoutineWithPreviewData>;

export interface RoutineRunData {
  id: string;
  routineId: string;
  scheduledFor: Date;
  status: RoutineRunStatus;
  trigger: "schedule" | "manual";
  requestId: string;
  submittedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  output: string | null;
  error: string | null;
  conversationId: string | null;
  tokens: number | null;
}

export type RecentRoutineRunData = RoutineRunData & { routineName: string; botName: string };

export type RoutineRun = Jsonified<RoutineRunData> & { routineName?: string; botName?: string };

export interface RoutineRuns {
  runs: RoutineRun[];
}

export interface RoutineRunStarted {
  runId: string;
}

export interface RoutineUpdateBody {
  botId?: string;
  name?: string;
  prompt?: string;
  schedule?: Schedule;
  enabled?: boolean;
}

export type RoutineCreateBody = RoutineUpdateBody & {
  botId: string;
  name: string;
  prompt: string;
  schedule: Schedule;
};
