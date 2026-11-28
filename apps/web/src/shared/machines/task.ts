import { defineMachine } from "../state-machine";
import type { StatusLabels } from "./status-label";

export const taskMachine = defineMachine({
  name: "task",
  states: ["todo", "in_progress", "done"],
  initial: ["todo", "in_progress", "done"],
  transitions: {
    todo: ["in_progress", "done"],
    in_progress: ["todo", "done"],
    done: ["todo", "in_progress"],
  },
});

export type TaskStatus = (typeof taskMachine.states)[number];

export const taskLabels: StatusLabels<TaskStatus> = {
  todo: { label: "To do", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  done: { label: "Done", tone: "success" },
};
