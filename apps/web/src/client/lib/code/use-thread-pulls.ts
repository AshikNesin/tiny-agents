/**
 * A Code thread's pull request view (`ThreadPullsView`), as every panel on
 * the page reads it: the same in every panel, so a read or an action's answer
 * in one panel (the PR tab) is what the others (the Review panel's branch
 * line) show too, without a second read.
 *
 * `useThreadPulls` owns how the view is read: on mount and whenever
 * `refreshKey` changes or `reload` is called, dropping an answer that
 * arrives after the next read started; with `live`, again every 15 seconds
 * while the page is visible, and at once when it is shown again. A failed
 * background read keeps what is shown; a failed foreground read says so.
 * `fresh` reconciles with GitHub first (the PR tab); without it, only the
 * branch and how far it is ahead are current.
 */
import { useCallback, useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { RESOURCE_QUERY } from "../../queries/resource";
import { errorMessage } from "../errors";
import { projectsApi } from "./projects";
import type { ThreadPullsView } from "../../../shared/api/code";

const LIVE_MS = 15_000;

/** Every read of one thread's view, whichever panel holds it. */
const pullsKey = (threadId: string) => ["code", "thread-pulls", threadId] as const;

interface ThreadPulls {
  view: ThreadPullsView | null;
  /** Why the last foreground read failed, until one succeeds. */
  error: string | null;
  /** Show an action's answer everywhere the thread's view is read. */
  setView(view: ThreadPullsView): void;
  /** Read again now. */
  reload(): void;
}

export function useThreadPulls(
  threadId: string,
  options: { refreshKey: unknown; fresh?: boolean; live?: boolean; enabled?: boolean },
): ThreadPulls {
  const { refreshKey, fresh = true, live = false, enabled = true } = options;
  const client = useQueryClient();
  const [reloads, setReloads] = useState(0);
  // Each panel's reads have their own key; an answer lands in all of them.
  const setView = useCallback(
    (next: ThreadPullsView) => {
      client.setQueriesData<ThreadPullsView>({ queryKey: pullsKey(threadId) }, next);
    },
    [client, threadId],
  );
  const query = useQuery({
    queryKey: [...pullsKey(threadId), { fresh, refreshKey, reloads }],
    queryFn: async ({ signal }) => {
      const next = await projectsApi.pulls(threadId, fresh);
      // An answer to a read a newer one replaced is dropped (its query was cancelled).
      if (!signal.aborted) setView(next);
      return next;
    },
    enabled,
    // What is shown stays while the next read is out.
    placeholderData: keepPreviousData,
    ...RESOURCE_QUERY,
    // Live: again on a beat while the page is visible (React Query skips a hidden page's beat).
    refetchInterval: live ? LIVE_MS : false,
  });
  // Live: at once when the page is shown again.
  const { refetch } = query;
  useEffect(() => {
    if (!live || !enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [live, enabled, refetch]);
  // A key's first read is the foreground one; a failed background read keeps what is shown.
  const failed = query.isError && query.data === undefined;

  return {
    view: query.data ?? null,
    error: failed ? errorMessage(query.error, "Could not read the PR.") : null,
    setView,
    reload: useCallback(() => setReloads((n) => n + 1), []),
  };
}
