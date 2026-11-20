import { defineMachine } from "../state-machine";

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
