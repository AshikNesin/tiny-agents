import { defineMachine } from "../state-machine";

/**
 * A memory row (`memories.ledger.ts` writes every move). Only `active` is
 * injected into a prompt; the rest is visible history on the Memory page.
 *
 *   active ─┬─ superseded  (a newer memory replaced it)
 *           ├─ archived    (over the active budget, oldest first)
 *           ├─ expired     (past its `until`)
 *           └─ deleted     (the owner removed it: a tombstone)
 *   superseded / archived / expired ─┬─ active   (the owner restores it)
 *                                    └─ deleted
 *   deleted ─ active   (only the owner adding the same text on the Memory page)
 */
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
