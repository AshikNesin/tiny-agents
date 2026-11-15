import { defineMachine } from "../state-machine";

/**
 * One Auto-fix pass (`code.passes.ts` writes every move; issue #297 §9.3):
 *
 *   starting ─ running    (the fix request was sent to the thread)
 *   starting ─ finished   (the worktree could not be synced, or the send failed)
 *   running ─ finished    (the thread's turn ended, or the pass ran out of time)
 *
 * A pass is claimed as `starting` before the harness hears anything, keyed by
 * a hash of the head sha and its items, so a second claim for the same state
 * of the PR loses and does nothing.
 */
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
