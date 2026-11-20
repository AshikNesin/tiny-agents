import { defineMachine } from "../state-machine";

export const autofixPassMachine = defineMachine({
  name: "code Auto-fix pass",
  states: ["starting", "running", "finished"],
  initial: ["starting"],
  transitions: {
    starting: ["running", "finished"],
    running: ["finished"],
    finished: [],
  },
});

export type AutofixPassStatus = (typeof autofixPassMachine.states)[number];
