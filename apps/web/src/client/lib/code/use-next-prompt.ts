import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TranscriptItem } from "@tiny-agents/code/contracts";
import { RESOURCE_QUERY, wait } from "../../queries/resource";
import { codeApi } from "./api";

const SETTLE_MS = 600;

let dismissed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const readDismissed = () => dismissed;

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
  const key = after ? `${threadId}\u0000${after}` : null;
  const answer = useQuery({
    queryKey: ["code", "next-prompt", threadId, after],
    queryFn: async ({ signal }) => {
      await wait(SETTLE_MS, signal);
      return (await codeApi.nextPrompt(threadId, after!)).text;
    },
    enabled: after !== null,
    ...RESOURCE_QUERY,
  });

  const gone = useSyncExternalStore(subscribe, readDismissed);
  const text = key && !gone.has(key) ? (answer.data ?? null) : null;
  return {
    text,
    dismiss: () => {
      if (!key) return;
      dismissed = new Set(dismissed).add(key);
      for (const listener of listeners) listener();
    },
  };
}
