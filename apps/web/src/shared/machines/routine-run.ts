import { defineMachine } from "../state-machine";

/**
 * One run of a routine at one slot (`routines.runs.ts` writes every move):
 *
 *   fire ─┬─ missed   (past the grace window, or the last run was still working; never submitted)
 *         ├─ failed   (the submit failed; the routine pauses)
 *         └─ awaiting ─┬─ succeeded
 *                      ├─ blocked    (it finished but could not do its job, issue #87)
 *                      ├─ failed     (model error, or interrupted by a restart)
 *                      └─ cancelled  (its routine moved to another bot)
 *
 * Only `awaiting` has a way out, so a run is resolved, announced and carded
 * once: the resolver's update is guarded by `sourcesOf(to)`.
 */
export const routineRunMachine = defineMachine({
  name: "routine run",
  states: ["awaiting", "succeeded", "blocked", "failed", "missed", "cancelled"],
  initial: ["awaiting", "missed", "failed"],
  transitions: {
    awaiting: ["succeeded", "blocked", "failed", "cancelled"],
    succeeded: [],
    blocked: [],
    failed: [],
    missed: [],
    cancelled: [],
  },
});

export type RoutineRunStatus = (typeof routineRunMachine.states)[number];

/** A run that has settled: what its card in the bot's chat shows. */
export type SettledRoutineRunStatus = Exclude<RoutineRunStatus, "awaiting">;
