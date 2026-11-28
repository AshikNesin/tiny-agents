import { defineMachine } from "../state-machine";
import type { StatusLabels } from "./status-label";

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

export const routineRunLabels: StatusLabels<RoutineRunStatus> = {
  awaiting: { label: "awaiting", tone: "neutral" },
  succeeded: { label: "succeeded", tone: "success" },
  blocked: { label: "needs attention", tone: "warning" },
  failed: { label: "failed", tone: "danger" },
  missed: { label: "missed", tone: "warning" },
  cancelled: { label: "cancelled", tone: "neutral" },
};
