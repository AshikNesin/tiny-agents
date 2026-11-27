import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { RESOURCE_QUERY } from "../../queries/resource";
import { errorMessage } from "../errors";
import { projectsApi } from "./projects";
import type { ThreadPullsView } from "../../../shared/api/code";

const LIVE_MS = 15_000;

const pullsKey = (threadId: string) => ["code", "thread-pulls", threadId] as const;

interface ThreadPulls {
  view: ThreadPullsView | null;
  error: string | null;
  setView(view: ThreadPullsView): void;
  reload(): void;
}

export function useThreadPulls(
  threadId: string,
  options: { refreshKey: unknown; fresh?: boolean; live?: boolean; enabled?: boolean },
): ThreadPulls {
  const { refreshKey, fresh = true, live = false, enabled = true } = options;
  const client = useQueryClient();
  const [reloads, setReloads] = useState(0);
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
      if (!signal.aborted) setView(next);
      return next;
    },
    enabled,
    placeholderData: keepPreviousData,
    ...RESOURCE_QUERY,
    refetchInterval: live ? LIVE_MS : false,
  });
  const { refetch } = query;
  useEffect(() => {
    if (!live || !enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [live, enabled, refetch]);
  const failed = query.isError && query.data === undefined;

  return {
    view: query.data ?? null,
    error: failed ? errorMessage(query.error, "Could not read the PR.") : null,
    setView,
    reload: useCallback(() => setReloads((n) => n + 1), []),
  };
}

export function usePullActions(threadId: string) {
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const act = useCallback(
    async (what: string, work: () => Promise<ThreadPullsView | void>): Promise<boolean> => {
      setBusy(what);
      try {
        const next = await work();
        if (next) client.setQueriesData<ThreadPullsView>({ queryKey: pullsKey(threadId) }, next);
        return true;
      } catch (error) {
        toast.error(errorMessage(error, `Could not ${what}.`));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [client, threadId],
  );
  return { busy, act };
}
