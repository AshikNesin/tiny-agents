/**
 * The turn-outcome rule, applied to every driver: each driver test plays the
 * same four turns on its own fake and this suite checks that `turn_ended`
 * and `outcome()` agree with the thread the driver shows
 * (`turnOutcomeProblems`) and with each other harness.
 */
import { describe, expect, it } from "vite-plus/test";
import type {
  HarnessInstance,
  InstanceEvent,
  TurnOutcome,
} from "../../../packages/code/src/contracts";
import { turnOutcomeProblems } from "../../../packages/code/src/testing";

export type TurnCase = "answered" | "failed" | "steered" | "unanswered";

/** What each played thread must come to, whichever harness ran it. */
export const TURN_CASES: Record<
  TurnCase,
  { story: string; users: string[]; text: string; failed: boolean }
> = {
  answered: {
    story: "a turn that answers `go` with `Done: 3 files.`",
    users: ["go"],
    text: "Done: 3 files.",
    failed: false,
  },
  failed: {
    story: "a turn `go` that ends in the error `boom`",
    users: ["go"],
    text: "boom",
    failed: true,
  },
  steered: {
    story: "a turn `task` that says `Halfway.`, takes the steer `also docs`, and stops",
    users: ["task", "also docs"],
    text: "Halfway.",
    failed: false,
  },
  unanswered: {
    story: "a turn `one` answered `First done.`, then a turn `two` stopped before any answer",
    users: ["one", "two"],
    text: "",
    failed: false,
  },
};

export interface PlayedTurn {
  harness: HarnessInstance;
  nativeId: string;
  /** The instance events so far, including the played turn's `turn_ended`. */
  events: readonly InstanceEvent[];
}

function lastEnd(events: readonly InstanceEvent[], nativeId: string): TurnOutcome | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type === "turn_ended" && event.nativeId === nativeId) return event.outcome;
  }
  return undefined;
}

/** `play` drives the driver's fake through one case and returns once its turn ended. */
export function describeTurnOutcomeRule(
  harnessName: string,
  play: (turn: TurnCase) => Promise<PlayedTurn>,
): void {
  describe(`${harnessName} keeps the turn-outcome rule`, () => {
    for (const [turn, expected] of Object.entries(TURN_CASES) as Array<
      [TurnCase, (typeof TURN_CASES)[TurnCase]]
    >) {
      it(expected.story, async () => {
        const { harness, nativeId, events } = await play(turn);
        const ended = lastEnd(events, nativeId);
        expect(ended, "a turn_ended with its outcome").toBeDefined();
        const snapshot = await harness.getThread(nativeId);
        const users = snapshot.items.flatMap((item) => (item.kind === "user" ? [item.text] : []));
        expect(users).toEqual(expected.users);
        const outcome = await harness.outcome(nativeId);
        expect(turnOutcomeProblems(snapshot, outcome, ended)).toEqual([]);
        expect(outcome).toMatchObject({
          working: false,
          text: expected.text,
          failed: expected.failed,
        });
        expect(outcome.endedAt).toEqual(expect.any(Number));
      });
    }
  });
}
