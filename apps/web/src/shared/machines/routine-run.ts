import { defineMachine } from "../state-machine";

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

export type SettledRoutineRunStatus = Exclude<RoutineRunStatus, "awaiting">;
