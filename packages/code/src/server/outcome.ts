/**
 * The turn-outcome rule: what a thread's newest turn came to, the same for
 * every harness. A driver hands it the thread as it shows it (the summary
 * and rows `getThread` answers) plus when the harness last wrote to it, and
 * uses the answer for both `outcome()` and the `turn_ended` event. Hand-offs,
 * the bots' `code_status` and pushes read only what it answers.
 */
import type { ThreadSummary, TranscriptItem, TurnOutcome } from "../contracts";
import { excerpt } from "./items";

/** What a driver knows about a thread when it asks for the outcome. */
export interface TurnFacts {
  /** The thread as the driver lists it. */
  thread: Pick<ThreadSummary, "title" | "cwd" | "working" | "cursor">;
  /** Its rows, oldest first: the ones `getThread` shows. */
  items: readonly TranscriptItem[];
  /**
   * When the harness last wrote to the thread's newest turn, on the
   * harness's own record (ms): Shelley's newest agent or error message,
   * Claude Code's newest result. Dropped while the thread works.
   */
  endedAt?: number;
}

const NO_ANSWER = { text: "", failed: false } as const;

/**
 * The newest turn's answer, chat-sized (`excerpt`): its newest assistant
 * text (consecutive text rows are one answer), or its error (`failed`).
 *
 * A turn ends at a `turn` row or an error. A user row after the newest turn
 * end opened a turn of its own: with nothing answered since, the answer is
 * empty, never an earlier turn's. A user row inside a turn is a steer: it
 * went into that turn, so the turn's answer before it still counts.
 */
export function turnAnswer(items: readonly TranscriptItem[]): { text: string; failed: boolean } {
  let userSince = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    switch (item.kind) {
      case "user":
        userSince = true;
        break;
      case "turn":
        if (userSince) return NO_ANSWER;
        break;
      case "notice":
        if (item.level !== "error") break;
        return userSince ? NO_ANSWER : { text: excerpt(item.text), failed: true };
      case "assistant": {
        const parts = [item.text];
        for (let j = i - 1; j >= 0; j--) {
          const before = items[j]!;
          if (before.kind === "assistant") parts.unshift(before.text);
          else if (before.kind !== "thinking") break;
        }
        return { text: excerpt(parts.join("\n")), failed: false };
      }
      default:
        break;
    }
  }
  return NO_ANSWER;
}

/** Where a thread stands now, by the one rule (`turnAnswer`). */
export function turnOutcome(facts: TurnFacts): TurnOutcome {
  const { thread } = facts;
  const answer = turnAnswer(facts.items);
  const endedAt =
    !thread.working && facts.endedAt !== undefined && Number.isFinite(facts.endedAt)
      ? facts.endedAt
      : undefined;
  return {
    working: thread.working,
    title: thread.title,
    cwd: thread.cwd,
    text: answer.text,
    failed: answer.failed,
    ...(endedAt !== undefined ? { endedAt } : {}),
    cursor: thread.cursor,
  };
}
