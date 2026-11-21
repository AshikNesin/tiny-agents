import { defineMachine } from "../state-machine";

export const handoffMachine = defineMachine({
  name: "code hand-off",
  states: ["starting", "running", "finished"],
  initial: ["starting", "running"],
  transitions: {
    starting: ["running"],
    running: ["finished"],
    finished: ["running"],
  },
});

export type HandoffStatus = (typeof handoffMachine.states)[number];
