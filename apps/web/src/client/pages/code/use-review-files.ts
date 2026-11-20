import { useCallback, useState } from "react";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import { useRefreshOn, useResource } from "../../queries/resource";
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
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  // The last list stays while the next scope's is out, and through a failed read.
  const filesKey = ["code", "review-files", threadId, scope];
  const {
    data: files,
    loadError: error,
    refresh: refetch,
  } = useResource(
    filesKey,
    async () => treeOrder(await projectsApi.reviewFiles(threadId, scope)),
    "Could not read the changes.",
    { placeholderData: keepPreviousData },
  );
  // Read again as the key settles and on refresh.
  useRefreshOn(`${String(settledKey)}\u0000${reload}`, refetch);
  const client = useQueryClient();
  const setFiles = (update: (list: ReviewFile[] | undefined) => ReviewFile[] | undefined) =>
    client.setQueryData<ReviewFile[]>(filesKey, update);

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
        setFiles((list) => list?.map((f) => (f.path === file.path ? { ...f, viewed } : f)));
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
