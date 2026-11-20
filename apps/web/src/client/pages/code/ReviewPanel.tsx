/**
 * Source control for a project thread (issue #297 §8): every change since
 * the merge base with the project's base branch, committed or not, in the
 * diff workspace (`DiffWorkspace`): one column of every changed file under
 * sticky headers (fold, Viewed, Edit), and the file tree with Files and
 * Comments. On the Review page the tree sits beside the column, with split or
 * unified and Fold all files; in the side pane the tree is a drawer (Files).
 * Viewed marks come back unmarked when the agent changes the file again.
 * Line comments wait above the thread's composer and go to the agent with the
 * next message. The scope picker also shows what one turn changed (its
 * checkpoint against the one before), with Revert to here.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  FileDiff as FileDiffIcon,
  GitBranch,
  ListTree,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, monoClass } from "@groot/ui";
import { useConfirm } from "@groot/ui/primitives";
import { cn } from "@groot/ui/lib/utils";
import { SearchSelect } from "../../components/ui/search-select";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import { useThreadPulls } from "../../lib/code/use-thread-pulls";
import type { CheckpointView, ReviewFile } from "../../../shared/api/code";
import type { ThreadCommenting } from "../../lib/code/comments";
import { useSteadyKey } from "../../lib/code/use-live-changes";
import {
  DiffViewButtons,
  DiffWorkspace,
  treeOrder,
  useDiffStyle,
  useWide,
  type CollapseAll,
} from "./DiffWorkspace";

export function ReviewPanel({
  threadId,
  baseBranch,
  refreshKey,
  onOtherScopes,
  commenting,
  page = false,
  editable = false,
}: {
  /** The thread. */
  threadId: string;
  baseBranch: string;
  refreshKey: unknown;
  /** At full width on the Review page: the tree beside the column. */
  page?: boolean;
  /** Files have Edit: the light editor, saving to the worktree. */
  editable?: boolean;
  /** The thread's line comments: absent, the diff takes none. */
  commenting?: ThreadCommenting;
  /** Uncommitted changes or one commit, from the harness (when it serves diffs). */
  onOtherScopes?: () => void;
}) {
  const settledKey = useSteadyKey(refreshKey);
  const [files, setFiles] = useState<ReviewFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const confirm = useConfirm();
  /** `base` or a checkpoint id. */
  const [scope, setScope] = useState("base");
  const worktreeScope = scope === "base";
  const [checkpoints, setCheckpoints] = useState<CheckpointView[]>([]);
  const checkpoint = checkpoints.find((c) => c.id === scope);
  const [style, setStyle] = useDiffStyle();
  const wide = useWide();
  const [collapse, setCollapse] = useState<CollapseAll>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const drawer = useMemo(() => ({ open: filesOpen, onOpenChange: setFilesOpen }), [filesOpen]);

  // No reconcile with GitHub: only the branch and how far it is ahead, shared with the PR tab.
  const pulls = useThreadPulls(threadId, {
    refreshKey: `${String(settledKey)}:${reload}`,
    fresh: false,
  });
  const branch = pulls.view ? { name: pulls.view.branch, ahead: pulls.view.ahead } : null;

  useEffect(() => {
    let cancelled = false;
    projectsApi
      .checkpoints(threadId)
      .then((list) => !cancelled && setCheckpoints(list))
      .catch(() => !cancelled && setCheckpoints([]));
    return () => {
      cancelled = true;
    };
  }, [threadId, settledKey, reload]);

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

  const revert = async () => {
    if (!checkpoint) return;
    const ok = await confirm({
      title: `Revert the files to turn ${checkpoint.seq}?`,
      description:
        "The worktree's files go back to how they were after that turn, as uncommitted changes. Commits stay; the current state is kept as a checkpoint you can return to.",
      confirmLabel: "Revert",
    });
    if (!ok) return;
    try {
      await projectsApi.revert(threadId, checkpoint.id);
      toast.success(`Files are back to turn ${checkpoint.seq}.`);
      setScope("base");
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(errorMessage(e, "Could not revert."));
    }
  };

  const scopeLabel = (c: CheckpointView) =>
    c.reason === "start"
      ? "Start of the thread"
      : c.reason === "before_revert"
        ? `Before a revert (${c.seq})`
        : `Turn ${c.seq}`;

  const topBar = Boolean(branch?.name) || Boolean(onOtherScopes) || page;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {topBar && (
        <div className="border-border text-muted-foreground flex h-10 shrink-0 items-center gap-1.5 border-b px-2 text-xs">
          {page && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground shrink-0 md:hidden"
              aria-label="Files"
              aria-expanded={filesOpen}
              onClick={() => setFilesOpen(!filesOpen)}
            >
              <ListTree />
            </Button>
          )}
          {branch?.name && (
            <p className="flex min-w-0 items-center gap-1.5 px-2">
              <GitBranch className="size-3.5 shrink-0" aria-hidden />
              <span className={cn("text-foreground min-w-0 truncate", monoClass)}>
                {branch.name}
              </span>
              <span aria-hidden>→</span>
              <span className={cn("shrink-0", monoClass)}>{baseBranch}</span>
              {branch.ahead !== null && branch.ahead > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span className="shrink-0 tabular-nums" title="Commits not on the base yet">
                    {branch.ahead} ahead
                  </span>
                </>
              )}
            </p>
          )}
          <span className="flex-1" />
          {onOtherScopes && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOtherScopes}
              className="text-muted-foreground"
            >
              Uncommitted or a commit
            </Button>
          )}
          {page && wide && (
            <DiffViewButtons
              style={style}
              onStyle={setStyle}
              collapse={collapse}
              onCollapse={setCollapse}
            />
          )}
        </div>
      )}
      <DiffWorkspace
        layout={page ? "page" : "panel"}
        files={files}
        error={error}
        scopeKey={`${threadId}\u0000${scope}`}
        readKey={String(reload)}
        read={read}
        diffStyle={page && wide ? style : "unified"}
        collapse={collapse}
        drawer={page ? drawer : undefined}
        commenting={commenting}
        onViewed={
          worktreeScope
            ? (file, viewed) => {
                setFiles(
                  (list) => list?.map((f) => (f.path === file.path ? { ...f, viewed } : f)) ?? list,
                );
                projectsApi
                  .setViewed(threadId, file.path, file.hash, viewed)
                  .catch((e: unknown) => {
                    toast.error(errorMessage(e, "Could not save that."));
                    setReload((n) => n + 1);
                  });
              }
            : undefined
        }
        canEdit={editable && worktreeScope ? () => true : undefined}
        onSave={async (path, original, content) => {
          await projectsApi.editFile(threadId, { path, original, content });
          setReload((n) => n + 1);
          toast.success("Saved.");
        }}
        scope={
          <SearchSelect
            label="Changes to show"
            value={scope}
            onValueChange={setScope}
            options={[
              {
                value: "base",
                label: `Since ${baseBranch}`,
                description: "Everything, committed or not",
              },
              ...checkpoints.map((c) => ({
                value: c.id,
                label: scopeLabel(c),
                description:
                  c.reason === "start"
                    ? "The files as the agent first saw them"
                    : `What it changed · on ${c.headSha.slice(0, 7)}`,
                group: "Turns",
              })),
            ]}
            triggerClassName={cn(
              "text-foreground h-8",
              page ? "w-full justify-start text-xs" : "max-w-full text-sm",
            )}
            data-testid="code-review-scope"
          >
            <FileDiffIcon className="text-muted-foreground size-4" />
            <span className="min-w-0 flex-1 truncate text-left">
              {checkpoint ? scopeLabel(checkpoint) : `Since ${baseBranch}`}
            </span>
            <ChevronDown className="opacity-50" />
          </SearchSelect>
        }
        actions={
          checkpoint && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void revert()}
              className="text-muted-foreground"
              data-testid="code-revert"
            >
              <RotateCcw />
              Revert to here
            </Button>
          )
        }
        onRefresh={() => setReload((n) => n + 1)}
        empty={
          <EmptyState
            icon={FileDiffIcon}
            title="No changes"
            description={`Nothing differs from ${baseBranch} yet.`}
          />
        }
      />
    </div>
  );
}
