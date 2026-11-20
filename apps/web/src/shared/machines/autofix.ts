import { defineMachine } from "../state-machine";

export const autofixMachine = defineMachine({
  name: "code PR Auto-fix",
  states: ["watching", "fixing", "needs_input", "green", "paused", "merged", "off"],
  initial: ["watching", "off"],
  transitions: {
    watching: ["fixing", "green", "paused", "needs_input", "merged", "off"],
    fixing: ["watching", "needs_input", "merged", "off"],
    needs_input: ["watching", "merged", "off"],
    green: ["watching", "merged", "off"],
    paused: ["watching", "merged", "off"],
    merged: [],
    off: ["watching", "merged"],
  },
});

export type AutofixStatus = (typeof autofixMachine.states)[number];
