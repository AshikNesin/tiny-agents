export type RoutineState = "scheduled" | "struggling" | "auto_paused" | "done" | "paused";

export function routineState(routine: {
  enabled: boolean;
  pausedReason: string | null;
  blockedStreak: number;
  done?: boolean;
}): RoutineState {
  if (routine.enabled) return routine.blockedStreak > 0 ? "struggling" : "scheduled";
  if (routine.pausedReason !== null) return "auto_paused";
  return routine.done ? "done" : "paused";
}

export const ROUTINE_NEEDS_ATTENTION: ReadonlySet<RoutineState> = new Set([
  "struggling",
  "auto_paused",
]);
