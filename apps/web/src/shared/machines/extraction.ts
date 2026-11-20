import { defineMachine } from "../state-machine";

export const extractionMachine = defineMachine({
  name: "upload extraction",
  states: ["none", "pending", "ready", "failed", "unsupported"],
  initial: ["none", "pending", "failed", "unsupported"],
  transitions: {
    none: ["pending"],
    pending: ["ready", "failed", "unsupported"],
    ready: [],
    failed: [],
    unsupported: [],
  },
});

export type ExtractStatus = (typeof extractionMachine.states)[number];
