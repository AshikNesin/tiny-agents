import { defineMachine } from "../state-machine";

export const memoryMachine = defineMachine({
  name: "memory",
  states: ["active", "superseded", "archived", "expired", "deleted"],
  initial: ["active"],
  transitions: {
    active: ["superseded", "archived", "expired", "deleted"],
    superseded: ["active", "deleted"],
    archived: ["active", "deleted"],
    expired: ["active", "deleted"],
    deleted: ["active"],
  },
});

export type MemoryStatus = (typeof memoryMachine.states)[number];
