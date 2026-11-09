import { defineMachine } from "../state-machine";

/**
 * Coding work a bot handed to a harness (`code.store.ts` writes every move):
 *
 *   running ─ finished   (the thread's turn ended: delivered once to the bot)
 *   finished ─ running   (the bot sent a follow-up: the next finish is delivered too)
 */
export const handoffMachine = defineMachine({
  name: "code hand-off",
  states: ["running", "finished"],
  initial: ["running"],
  transitions: {
    running: ["finished"],
    finished: ["running"],
  },
});

export type HandoffStatus = (typeof handoffMachine.states)[number];
