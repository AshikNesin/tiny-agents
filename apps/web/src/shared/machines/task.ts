import { defineMachine } from "../state-machine";

/**
 * An owner task (`task.service.ts` writes every move). Any status may move
 * to any other; the invariant rides on the edges: entering `done` stamps
 * `completedAt`, leaving it clears it, and staying `done` keeps the first
 * stamp (the Completed tab sorts by it).
 */
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
