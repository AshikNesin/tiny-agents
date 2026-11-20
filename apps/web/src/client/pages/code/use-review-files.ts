import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import { useSteadyKey } from "../../lib/code/use-live-changes";
import type { ReviewFile } from "../../../shared/api/code";
import { treeOrder } from "./DiffWorkspace";

/**
 * A worktree's changed files in one scope (`projectsApi.reviewFiles`: `base`,
 * `review`, `mine` or a checkpoint id), read again as `refreshKey` settles,
 * with the reads, Viewed marks and light-editor saves a `DiffWorkspace` takes.
 * `saved` is the toast after a save.
 */
export function useReviewFiles(
  threadId: string,
  scope: string,
  refreshKey: unknown,
  saved = "Saved.",
) {
  const settledKey = useSteadyKey(refreshKey);
  const [files, setFiles] = useState<ReviewFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    projectsApi
      .reviewFiles(threadId, scope)
      .then((list) => !cancelled && setFiles(treeOrder(list)))
      .catch(
        (e: unknown) => !cancelled && setError(errorMessage(e, "Could not read the changes.")),
      );
    return () => {
      cancelled = true;
    };
  }, [threadId, settledKey, reload, scope]);

  const read = useCallback(
    (path: string) => projectsApi.reviewFile(threadId, path, scope),
    [threadId, scope],
  );

  return {
    settledKey,
    reload,
    refresh,
    /** Spread onto `DiffWorkspace`. */
    workspace: {
      files,
      error,
      scopeKey: `${threadId}\u0000${scope}`,
      readKey: String(reload),
      read,
      onRefresh: refresh,
      onViewed: (file: ReviewFile, viewed: boolean) => {
        setFiles((list) => list?.map((f) => (f.path === file.path ? { ...f, viewed } : f)) ?? list);
        projectsApi.setViewed(threadId, file.path, file.hash, viewed).catch((e: unknown) => {
          toast.error(errorMessage(e, "Could not save that."));
          refresh();
        });
      },
      onSave: async (path: string, original: string, content: string) => {
        await projectsApi.editFile(threadId, { path, original, content });
        refresh();
        toast.success(saved);
      },
    },
  };
}
