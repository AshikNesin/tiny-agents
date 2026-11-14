import { defineMachine } from "../state-machine";

/**
 * Coding work a bot handed to a harness (`code.store.ts` writes every move):
 *
 *   starting ─ running   (the harness made the thread: a replayed start returns it)
 *   running ─ finished   (the thread's turn ended: its finish is owed to the bot)
 *   finished ─ running   (the bot sent a follow-up: the next finish is owed too)
 *
 * A start claims its row as `starting` before the harness makes the thread;
 * one the harness refused is deleted. An adopted thread starts `running`.
 */
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
