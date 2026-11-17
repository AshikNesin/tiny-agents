/**
 * A Code thread's pull request view (`ThreadPullsView`), as every panel on
 * the page reads it: one copy per thread, so a read or an action's answer
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
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { errorMessage } from "../errors";
import { projectsApi } from "./projects";
import type { ThreadPullsView } from "../../../shared/api/code";

const LIVE_MS = 15_000;

const views = new Map<string, ThreadPullsView>();
const listeners = new Map<string, Set<() => void>>();

function setThreadPulls(threadId: string, view: ThreadPullsView): void {
  views.set(threadId, view);
  for (const listener of listeners.get(threadId) ?? []) listener();
}

function subscribe(threadId: string, listener: () => void): () => void {
  const set = listeners.get(threadId) ?? new Set();
  set.add(listener);
  listeners.set(threadId, set);
  return () => {
    set.delete(listener);
    // The last reader gone: the next mount reads afresh, as before.
    if (set.size === 0) {
      listeners.delete(threadId);
      views.delete(threadId);
    }
  };
}

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
  options: { refreshKey: unknown; fresh?: boolean; live?: boolean },
): ThreadPulls {
  const { refreshKey, fresh = true, live = false } = options;
  const view = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(threadId, listener), [threadId]),
    () => views.get(threadId) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    projectsApi
      .pulls(threadId, fresh)
      .then((next) => !cancelled && setThreadPulls(threadId, next))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e, "Could not read the PR.")));
    return () => {
      cancelled = true;
    };
  }, [threadId, fresh, refreshKey, reloads]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let reading = false;
    const read = () => {
      if (reading || document.visibilityState !== "visible") return;
      reading = true;
      projectsApi
        .pulls(threadId, fresh)
        .then((next) => {
          if (cancelled) return;
          setThreadPulls(threadId, next);
          setError(null);
        })
        .catch(() => undefined)
        .finally(() => {
          reading = false;
        });
    };
    const timer = setInterval(read, LIVE_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [threadId, fresh, live]);

  return {
    view,
    error,
    setView: useCallback((next: ThreadPullsView) => setThreadPulls(threadId, next), [threadId]),
    reload: useCallback(() => setReloads((n) => n + 1), []),
  };
}
