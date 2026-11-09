/**
 * What a routine is doing, derived from the fields that carry it
 * (`enabled`, `pausedReason`, `blockedStreak`, `done`), so the
 * page reads one value instead of re-deriving it from four:
 *
 * - `scheduled`: armed, the next run is queued.
 * - `struggling`: armed, but its last runs were blocked (three in a row pause it).
 * - `auto_paused`: the app paused it (a failed submit, or blocked runs); `pausedReason` says why.
 * - `done`: a one-off that has run; editing it picks a new time.
 * - `paused`: the owner paused it.
 */
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

/** States that show the "Needs attention" badge. */
export const ROUTINE_NEEDS_ATTENTION: ReadonlySet<RoutineState> = new Set([
  "struggling",
  "auto_paused",
]);
