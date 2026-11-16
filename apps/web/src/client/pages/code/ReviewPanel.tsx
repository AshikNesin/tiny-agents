/**
 * Review for a project thread (issue #297 §8): every change since the merge
 * base with the project's base branch, committed or not. A file list with
 * +/− and a filter (generated files and lockfiles muted and last), Viewed
 * marks that come back unmarked when the agent changes the file again,
 * `[` / `]` between files, and line comments written under their lines that
 * wait above the thread's composer and go to the agent with the next message. The scope picker also shows what one turn changed (its
 * checkpoint against the one before), with Revert to here.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileDiff as FileDiffIcon,
  Maximize2,
  PanelLeft,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Checkbox, EmptyState, Input, monoClass } from "@groot/ui";
import { useConfirm } from "@groot/ui/primitives";
import { cn } from "@groot/ui/lib/utils";
import { SearchSelect } from "../../components/ui/search-select";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import type { CheckpointView, ReviewFile, ReviewFileDiff } from "../../../shared/api/code";
import { fileCommenting, type ThreadCommenting } from "../../lib/code/comments";
import { useSteadyKey } from "../../lib/code/use-live-changes";
import { FileDiff } from "./UnifiedDiff";

const STATUS_TONE: Record<ReviewFile["status"], string> = {
  added: "text-success",
  modified: "text-warning",
  deleted: "text-destructive",
};

const TREE_KEY = "tiny-agents:code-review-files";

function readTree(): boolean {
  try {
    return window.localStorage.getItem(TREE_KEY) !== "hidden";
  } catch {
    return true;
  }
}

/** Real files first, generated ones last; each group by path. */
function reviewOrder(files: ReviewFile[]): ReviewFile[] {
  return [...files].sort(
    (a, b) => Number(a.isGenerated) - Number(b.isGenerated) || a.path.localeCompare(b.path),
  );
}

export function ReviewPanel({
  threadId,
  baseBranch,
  refreshKey,
  onClose,
  onExpand,
  onOtherScopes,
  commenting,
}: {
  threadId: string;
  baseBranch: string;
  refreshKey: unknown;
  onClose(): void;
  /** Show this at full width on the thread's Review page. */
  onExpand?: () => void;
  /** The thread's line comments: absent, the diff takes none. */
  commenting?: ThreadCommenting;
  /** Uncommitted changes or one commit, from the harness (when it serves diffs). */
  onOtherScopes?: () => void;
}) {
  const settledKey = useSteadyKey(refreshKey);
  const [files, setFiles] = useState<ReviewFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  // The open file's diff, with the file and content (hash) it was read for: a
  // re-read after the agent changed the file swaps it in place.
  const [shown, setShown] = useState<{ key: string; diff: ReviewFileDiff } | null>(null);
  const [reload, setReload] = useState(0);
  // The file list beside the diff; hidden, the file bar still steps through files.
  const [tree, setTree] = useState(readTree);
  const toggleTree = () => {
    setTree(!tree);
    try {
      window.localStorage.setItem(TREE_KEY, tree ? "hidden" : "shown");
    } catch {
      // not remembered in private mode
    }
  };
  const confirm = useConfirm();
  /** `base`, or a checkpoint id (what that turn changed). */
  const [scope, setScope] = useState("base");
  const [checkpoints, setCheckpoints] = useState<CheckpointView[]>([]);
  const checkpoint = checkpoints.find((c) => c.id === scope);

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
    const list =
      scope === "base"
        ? projectsApi.reviewFiles(threadId)
        : projectsApi.checkpointFiles(threadId, scope);
    list
      .then((list) => {
        if (cancelled) return;
        const ordered = reviewOrder(list);
        setFiles(ordered);
        setCurrent((c) =>
          c && ordered.some((f) => f.path === c) ? c : (ordered[0]?.path ?? null),
        );
      })
      .catch(
        (e: unknown) => !cancelled && setError(errorMessage(e, "Could not read the changes.")),
      );
    return () => {
      cancelled = true;
    };
  }, [threadId, settledKey, reload, scope]);

  const currentFile = files?.find((f) => f.path === current);
  const currentHash = currentFile?.hash;
  const diffKey = `${scope}:${current ?? ""}`;
  const diff = shown?.key === diffKey ? shown.diff : null;

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    (scope === "base"
      ? projectsApi.reviewFile(threadId, current)
      : projectsApi.checkpointFile(threadId, scope, current)
    )
      .then((d) => !cancelled && setShown({ key: `${scope}:${current}`, diff: d }))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e, "Could not read the diff.")));
    return () => {
      cancelled = true;
    };
  }, [threadId, current, currentHash, reload, scope]);

  const listedFiles = useMemo(
    () =>
      (files ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())),
    [files, filter],
  );

  // `[` and `]` move between files (not while typing).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "[" && event.key !== "]") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      const index = listedFiles.findIndex((f) => f.path === current);
      const next = listedFiles[index + (event.key === "]" ? 1 : -1)];
      if (next) {
        event.preventDefault();
        setCurrent(next.path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listedFiles, current]);

  const toggleViewed = (file: ReviewFile) => {
    const viewed = !file.viewed;
    setFiles((list) => list?.map((f) => (f.path === file.path ? { ...f, viewed } : f)) ?? list);
    projectsApi.setViewed(threadId, file.path, file.hash, viewed).catch((e: unknown) => {
      toast.error(errorMessage(e, "Could not save that."));
      setReload((n) => n + 1);
    });
  };

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

  const totals = (files ?? []).reduce(
    (sum, f) => ({
      add: sum.add + f.additions,
      del: sum.del + f.deletions,
      viewed: sum.viewed + Number(f.viewed),
    }),
    { add: 0, del: 0, viewed: 0 },
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-review">
      <div className="border-border flex h-13 shrink-0 items-center gap-1 border-b px-2">
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
          triggerClassName="text-foreground h-8 text-sm"
          data-testid="code-review-scope"
        >
          <FileDiffIcon className="text-muted-foreground size-4" />
          <span className="max-w-48 truncate">
            {checkpoint ? scopeLabel(checkpoint) : `Since ${baseBranch}`}
          </span>
          <ChevronDown className="opacity-50" />
        </SearchSelect>
        {checkpoint && (
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
        )}
        {files && files.length > 0 && (
          <span className="text-muted-foreground shrink-0 px-1 text-xs tabular-nums">
            {scope === "base"
              ? `${totals.viewed}/${files.length} viewed `
              : `${files.length} files `}
            <span className="text-success">+{totals.add}</span>{" "}
            <span className="text-destructive">−{totals.del}</span>
          </span>
        )}
        <span className="flex-1" />
        {files && files.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleTree}
            aria-pressed={tree}
            aria-label={tree ? "Hide file list" : "Show file list"}
            title={tree ? "Hide file list" : "Show file list"}
            className="text-muted-foreground"
          >
            <PanelLeft />
          </Button>
        )}
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
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setReload((n) => n + 1)}
          aria-label="Refresh changes"
          className="text-muted-foreground"
        >
          <RefreshCw />
        </Button>
        {onExpand && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onExpand}
            aria-label="Open as a page"
            title="Open as a page"
            className="text-muted-foreground"
          >
            <Maximize2 />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close changes"
          className="text-muted-foreground"
        >
          <X />
        </Button>
      </div>

      {error ? (
        <p className="text-destructive p-4 text-sm">{error}</p>
      ) : !files ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          icon={FileDiffIcon}
          title="No changes"
          description={`Nothing differs from ${baseBranch} yet.`}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {tree && (
            <nav
              className="border-border flex max-h-56 shrink-0 flex-col border-b md:max-h-none md:w-64 md:border-r md:border-b-0"
              aria-label="Changed files"
            >
              <div className="p-2">
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter files"
                  aria-label="Filter files"
                  className="h-8"
                />
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
                {listedFiles.map((f) => (
                  <li key={f.path} className="flex items-center gap-1">
                    {scope === "base" && (
                      <Checkbox
                        checked={f.viewed}
                        onCheckedChange={() => toggleViewed(f)}
                        aria-label={`Viewed ${f.path}`}
                        className="ml-1 shrink-0"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setCurrent(f.path)}
                      aria-current={f.path === current}
                      className={cn(
                        "hover:bg-muted flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs",
                        f.path === current && "bg-muted",
                        (f.isGenerated || f.viewed) && "text-muted-foreground",
                      )}
                      title={f.path}
                    >
                      <span className={cn("min-w-0 flex-1 truncate", monoClass)}>{f.path}</span>
                      <span className={cn("shrink-0 tabular-nums", STATUS_TONE[f.status])}>
                        +{f.additions} −{f.deletions}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {currentFile && (
              <FileBar
                file={currentFile}
                index={listedFiles.findIndex((f) => f.path === currentFile.path)}
                count={listedFiles.length}
                onStep={(step) => {
                  const index = listedFiles.findIndex((f) => f.path === currentFile.path);
                  const next = listedFiles[index + step];
                  if (next) setCurrent(next.path);
                }}
                onViewed={scope === "base" ? () => toggleViewed(currentFile) : undefined}
              />
            )}
            {!diff ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : (
              <FileDiff
                key={diffKey}
                path={current ?? ""}
                oldContent={diff.oldContent}
                newContent={diff.newContent}
                unshowable={diff.unshowable}
                {...fileCommenting(commenting, diff)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The open file over its diff: where it is in the list, a step either way, and Viewed. */
function FileBar({
  file,
  index,
  count,
  onStep,
  onViewed,
}: {
  file: ReviewFile;
  index: number;
  count: number;
  onStep(step: -1 | 1): void;
  onViewed?: () => void;
}) {
  const slash = file.path.lastIndexOf("/");
  return (
    <div className="bg-background/95 border-border sticky top-0 z-10 flex h-9 items-center gap-1 border-b px-2 text-xs backdrop-blur">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Previous file"
        title="Previous file ([)"
        disabled={index <= 0}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Next file"
        title="Next file (])"
        disabled={index < 0 || index >= count - 1}
        onClick={() => onStep(1)}
      >
        <ChevronRight />
      </Button>
      <span className={cn("flex min-w-0 flex-1", monoClass)} title={file.path}>
        <span className="text-muted-foreground truncate">{file.path.slice(0, slash + 1)}</span>
        <span className="shrink-0">{file.path.slice(slash + 1)}</span>
      </span>
      {index >= 0 && (
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {index + 1} of {count}
        </span>
      )}
      <span className={cn("shrink-0 tabular-nums", STATUS_TONE[file.status])}>
        +{file.additions} −{file.deletions}
      </span>
      {onViewed && (
        <label className="text-muted-foreground flex shrink-0 items-center gap-1.5 pl-1">
          <Checkbox
            checked={file.viewed}
            onCheckedChange={onViewed}
            aria-label={`Viewed ${file.path}`}
          />
          Viewed
        </label>
      )}
    </div>
  );
}
