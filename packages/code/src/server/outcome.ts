import type { ThreadSummary, TranscriptItem, TurnOutcome } from "../contracts";
import { excerpt } from "./items";

export interface TurnFacts {
  thread: Pick<ThreadSummary, "title" | "cwd" | "working" | "cursor">;
  items: readonly TranscriptItem[];
  endedAt?: number;
}

const NO_ANSWER = { text: "", failed: false } as const;

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
