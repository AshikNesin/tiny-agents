import { defineMachine } from "../state-machine";

/**
 * A linked pull request's Auto-fix loop (`code.pulls.ts` writes every move,
 * compare-and-set; issue #297 §9):
 *
 *   watching ─ fixing        (decide() started a pass)
 *   fixing ─ watching        (the pass pushed a commit)
 *   fixing ─ needs_input     (no progress, a rejected push, a protected path, a timeout)
 *   watching ─ green         (checks green, nothing open)
 *   green ─ watching         (a new review or a new failure)
 *   watching ─ paused        (the hourly pass limit)
 *   paused ─ watching        (a human pushed, reviewed or wrote)
 *   needs_input ─ watching   (the owner wrote in the thread, or switched it on again)
 *   * ─ merged               (the PR merged; the loop ends)
 *   * ─ off                  (closed, unlinked, switched off, or 10 passes without the owner)
 *   off ─ watching           (switched on again)
 */
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
