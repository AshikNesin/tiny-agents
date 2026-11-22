import { defineMachine } from "../state-machine";

export const runMachine = defineMachine({
  name: "code run",
  states: ["running", "stopping", "done", "failed", "stopped"],
  initial: ["running", "done", "failed"],
  transitions: {
    running: ["stopping", "done", "failed"],
    stopping: ["stopped", "failed"],
    done: [],
    failed: [],
    stopped: [],
  },
});

export type RunStatus = (typeof runMachine.states)[number];
