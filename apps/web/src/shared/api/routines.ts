/** The Routines API's wire types (`server/api/routines`); naming in `./common.ts`. */
import type { Jsonified } from "../json";
import type { RoutineRunStatus } from "../machines/routine-run";

/** The schedule union as it travels on the wire (PRD 5.1); `routines.schedule.ts` parses it. */
export type Schedule =
  | { kind: "once"; at: string }
  | { kind: "cron"; expr: string }
  | { kind: "interval"; minutes: number };

/** A routine as the routes return it (`routines.service.ts`). */
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
  /** A one-time routine whose time has passed: finished, not paused. */
  done: boolean;
  /** Runs in a row that ended blocked (issue #87); 3 pause the routine. */
  blockedStreak: number;
  /** Why the app paused it ("Paused after 3 blocked runs: …"); null otherwise. */
  pausedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type Routine = Jsonified<RoutineData>;

/** Create and patch responses add the pre-rendered next fire times (PRD 5.2). */
export type RoutineWithPreviewData = RoutineData & { nextFireTimes: string[] };
export type RoutineWithPreview = Jsonified<RoutineWithPreviewData>;

/** One run: the `routine_runs` row as it is stored. */
export interface RoutineRunData {
  id: string;
  routineId: string;
  scheduledFor: Date;
  /** `blocked`: it finished but could not do its job; `error` says why (issue #87). */
  status: RoutineRunStatus;
  trigger: "schedule" | "manual";
  /** The pi-durable submit id: `routine:<routineId>:<scheduledFor ISO>`. */
  requestId: string;
  submittedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  output: string | null;
  error: string | null;
  /** The run's own conversation (each run starts fresh); null for older runs. */
  conversationId: string | null;
  /** Tokens the run used, read when it settled; null while running or for older runs. */
  tokens: number | null;
}

/** `GET /routines/runs/recent` adds whose run it was. */
export type RecentRoutineRunData = RoutineRunData & { routineName: string; botName: string };

/** A run as either runs list returns it: the recent list names its routine and bot. */
export type RoutineRun = Jsonified<RoutineRunData> & { routineName?: string; botName?: string };

/** `GET /routines/:id/runs` and `GET /routines/runs/recent`. */
export interface RoutineRuns {
  runs: RoutineRun[];
}

/** `POST /routines/:id/run`: the run's id, or "" when the occurrence was not dispatched. */
export interface RoutineRunStarted {
  runId: string;
}

/** `PATCH /routines/:id`: at least one field. */
export interface RoutineUpdateBody {
  botId?: string;
  name?: string;
  prompt?: string;
  schedule?: Schedule;
  enabled?: boolean;
}

/** `POST /routines`. */
export type RoutineCreateBody = RoutineUpdateBody & {
  botId: string;
  name: string;
  prompt: string;
  schedule: Schedule;
};
