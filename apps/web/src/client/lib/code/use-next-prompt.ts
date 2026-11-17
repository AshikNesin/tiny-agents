/**
 * The composer's suggested next message (server: `code.next-prompt.ts`).
 * Asked for once per finished turn: when the thread stops working and its
 * newest row is an answer, after a short pause so the turn's last rows have
 * landed. The server keeps each turn's answer, so a remount or a second tab
 * is free. Esc dismisses it for that turn, across remounts.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { TranscriptItem } from "@tiny-agents/code/contracts";
import { codeApi } from "./api";

/** Lets a turn's closing rows (cost, `turn`) arrive before asking. */
const SETTLE_MS = 600;

let dismissed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const readDismissed = () => dismissed;

/** The newest row, when it ends a turn with an answer worth following. */
function answeredRow(items: readonly TranscriptItem[]): string | null {
  const last = items.at(-1);
  return last && (last.kind === "turn" || last.kind === "assistant") ? last.id : null;
}

export function useNextPrompt(
  threadId: string,
  items: readonly TranscriptItem[],
  working: boolean,
  enabled: boolean,
): { text: string | null; dismiss(): void } {
  const after = enabled && !working ? answeredRow(items) : null;
  const [answer, setAnswer] = useState<{ key: string; text: string | null } | null>(null);
  const key = after ? `${threadId}\u0000${after}` : null;

  useEffect(() => {
    if (!key || !after) return;
    let live = true;
    const timer = setTimeout(() => {
      codeApi
        .nextPrompt(threadId, after)
        .then((r) => live && setAnswer({ key, text: r.text }))
        .catch(() => undefined);
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [threadId, after, key]);

  const gone = useSyncExternalStore(subscribe, readDismissed);
  const text = key && answer?.key === key && !gone.has(key) ? answer.text : null;
  return {
    text,
    dismiss: () => {
      if (!key) return;
      dismissed = new Set(dismissed).add(key);
      for (const listener of listeners) listener();
    },
  };
}
