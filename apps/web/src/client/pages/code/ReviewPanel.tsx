/**
 * Source control for a project thread (issue #297 §8): every change since
 * the merge base with the project's base branch, committed or not. The
 * branch and how far it is ahead, then a file list (name, folder, +/−, a
 * status letter) with a filter (generated files and lockfiles muted and
 * last). In the side panel the list comes first and a file opens to its
 * diff (All files goes back); on the Review page they sit side by side. Viewed
 * marks that come back unmarked when the agent changes the file again,
 * `[` / `]` between files, and line comments written under their lines that
 * wait above the thread's composer and go to the agent with the next message. The scope picker also shows what one turn changed (its
 * checkpoint against the one before), with Revert to here.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileDiff as FileDiffIcon,
  GitBranch,
  List,
  PanelLeft,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Checkbox, EmptyState, Input, monoClass } from "@groot/ui";
import { useConfirm } from "@groot/ui/primitives";
import { cn } from "@groot/ui/lib/utils";
import { SearchSelect } from "../../components/ui/search-select";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import { useThreadPulls } from "../../lib/code/use-thread-pulls";
import type { CheckpointView, ReviewFile, ReviewFileDiff } from "../../../shared/api/code";
import { fileCommenting, type ThreadCommenting } from "../../lib/code/comments";
import type { FileConversations } from "./PullThreads";
import { useSteadyKey } from "../../lib/code/use-live-changes";
import { FileDiff } from "./UnifiedDiff";

const STATUS_TONE: Record<ReviewFile["status"], string> = {
  added: "text-success",
  modified: "text-warning",
  deleted: "text-destructive",
};

const STATUS_LETTER: Record<ReviewFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

/** "src/auth/login.ts" → ["login.ts", "src/auth"]. */
function splitPath(path: string): [string, string] {
  const slash = path.lastIndexOf("/");
  return [path.slice(slash + 1), slash > 0 ? path.slice(0, slash) : ""];
}

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
  onOtherScopes,
  commenting,
  githubCommenting,
  conversations,
  page = false,
  pull,
}: {
  /** The thread, or a PR review's key (`review:<id>`, with `pull`). */
  threadId: string;
  baseBranch: string;
  refreshKey: unknown;
  /** At full width on the Review page: the list beside the diff. */
  page?: boolean;
  /** The thread's line comments: absent, the diff takes none. */
  commenting?: ThreadCommenting;
  /** A PR review's comments for GitHub, beside the assistant's. */
  githubCommenting?: ThreadCommenting;
  /** A PR review's conversations from GitHub, per file. */
  conversations?: (path: string) => FileConversations;
  /** Uncommitted changes or one commit, from the harness (when it serves diffs). */
  onOtherScopes?: () => void;
  /**
   * A PR review (issue #345): its branch line, no turns to step through, and
   * with `reviewedSha` (the owner's last review, older than the head) a
   * "Since your review" scope, shown first.
   */
  pull?: {
    headRef: string;
    reviewedSha?: string | null;
    /**
     * With it, a "Your changes" scope (what was changed in the review's
     * checkout on top of the PR's head) shows these actions over its files;
     * `done` reads the changes again.
     */
    yourChanges?: (done: () => void) => ReactNode;
  };
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
  // In the side panel: the list, or one file's diff.
  const [listing, setListing] = useState(!page);
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
  /**
   * `base`, `review` (since the owner's last review of a PR), `mine` (the
   * owner's changes on top of a PR's head), or a checkpoint id.
   */
  const [picked, setScope] = useState<string | null>(null);
  const scope = picked ?? (pull?.reviewedSha ? "review" : "base");
  // Viewed marks are per file content, so they hold in either whole-PR scope.
  const viewable = scope === "base" || scope === "review";
  const [checkpoints, setCheckpoints] = useState<CheckpointView[]>([]);
  const checkpoint = checkpoints.find((c) => c.id === scope);

  // No reconcile with GitHub: only the branch and how far it is ahead, shared with the PR tab.
  const pulls = useThreadPulls(threadId, {
    refreshKey: `${String(settledKey)}:${reload}`,
    fresh: false,
    enabled: !pull,
  });
  const branch = pull
    ? { name: pull.headRef, ahead: null }
    : pulls.view
      ? { name: pulls.view.branch, ahead: pulls.view.ahead }
      : null;

  useEffect(() => {
    if (pull) return;
    let cancelled = false;
    projectsApi
      .checkpoints(threadId)
      .then((list) => !cancelled && setCheckpoints(list))
      .catch(() => !cancelled && setCheckpoints([]));
    return () => {
      cancelled = true;
    };
  }, [threadId, settledKey, reload, pull]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    projectsApi
      .reviewFiles(threadId, scope)
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

  const reading = page || !listing;
  useEffect(() => {
    if (!current || !reading) return;
    let cancelled = false;
    projectsApi
      .reviewFile(threadId, current, scope)
      .then((d) => !cancelled && setShown({ key: `${scope}:${current}`, diff: d }))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e, "Could not read the diff.")));
    return () => {
      cancelled = true;
    };
  }, [threadId, current, currentHash, reload, scope, reading]);

  const listedFiles = useMemo(
    () =>
      (files ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())),
    [files, filter],
  );

  // `[` and `]` move between files (not while typing), once one is open.
  useEffect(() => {
    if (!reading) return;
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
  }, [listedFiles, current, reading]);

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
      {branch?.name && (
        <p className="border-border text-muted-foreground flex h-9 shrink-0 items-center gap-1.5 border-b px-4 text-xs">
          <GitBranch className="size-3.5 shrink-0" aria-hidden />
          <span className={cn("text-foreground min-w-0 truncate", monoClass)}>{branch.name}</span>
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
      <div className="border-border flex h-11 shrink-0 items-center gap-1 border-b px-2">
        {pull?.reviewedSha || pull?.yourChanges ? (
          <SearchSelect
            label="Changes to show"
            value={scope}
            onValueChange={setScope}
            options={[
              ...(pull.reviewedSha
                ? [
                    {
                      value: "review",
                      label: "Since your review",
                      description: `What changed after ${pull.reviewedSha.slice(0, 7)}`,
                    },
                  ]
                : []),
              {
                value: "base",
                label: `Since ${baseBranch}`,
                description: "The whole pull request",
              },
              ...(pull.yourChanges
                ? [
                    {
                      value: "mine",
                      label: "Your changes",
                      description: "Changed in this checkout, not on GitHub yet",
                    },
                  ]
                : []),
            ]}
            triggerClassName="text-foreground h-8 text-sm"
          >
            <FileDiffIcon className="text-muted-foreground size-4" />
            <span className="max-w-48 truncate">
              {scope === "review"
                ? "Since your review"
                : scope === "mine"
                  ? "Your changes"
                  : `Since ${baseBranch}`}
            </span>
            <ChevronDown className="opacity-50" />
          </SearchSelect>
        ) : pull ? (
          <span className="text-foreground flex h-8 items-center gap-1.5 px-2 text-sm">
            <FileDiffIcon className="text-muted-foreground size-4" />
            Since {baseBranch}
          </span>
        ) : (
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
        )}
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
            {viewable
              ? `${totals.viewed}/${files.length} viewed `
              : `${files.length === 1 ? "1 file" : `${files.length} files`} `}
            <span className="text-success">+{totals.add}</span>{" "}
            <span className="text-destructive">−{totals.del}</span>
          </span>
        )}
        <span className="flex-1" />
        {scope === "mine" &&
          files &&
          files.length > 0 &&
          pull?.yourChanges?.(() => setReload((n) => n + 1))}
        {page && files && files.length > 0 && (
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
      </div>

      {error ? (
        <p className="text-destructive p-4 text-sm">{error}</p>
      ) : !files ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : files.length === 0 && scope === "mine" ? (
        <EmptyState
          icon={FileDiffIcon}
          title="You have not changed anything"
          description="Ask the assistant to change something, or open a terminal in this checkout."
        />
      ) : files.length === 0 ? (
        <EmptyState
          icon={FileDiffIcon}
          title="No changes"
          description={`Nothing differs from ${baseBranch} yet.`}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {(page ? tree : listing) && (
            <nav
              className={cn(
                "flex min-h-0 flex-col",
                page
                  ? "border-border max-h-56 shrink-0 border-b md:max-h-none md:w-72 md:border-r md:border-b-0"
                  : "flex-1",
              )}
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
                {listedFiles.map((f) => {
                  const [name, dir] = splitPath(f.path);
                  return (
                    <li key={f.path} className="flex items-center gap-1">
                      {viewable && (
                        <Checkbox
                          checked={f.viewed}
                          onCheckedChange={() => toggleViewed(f)}
                          aria-label={`Viewed ${f.path}`}
                          className="ml-1.5 shrink-0"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setCurrent(f.path);
                          setListing(false);
                        }}
                        aria-current={page && f.path === current}
                        className={cn(
                          "hover:bg-muted flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-xs",
                          page && f.path === current && "bg-muted",
                          (f.isGenerated || f.viewed) && "opacity-60",
                        )}
                        title={f.path}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{name}</span>
                          {dir && (
                            <span className={cn("text-muted-foreground ml-2", monoClass)}>
                              {dir}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {f.additions > 0 && <span className="text-success">+{f.additions}</span>}
                          {f.deletions > 0 && (
                            <span className="text-destructive ml-1">−{f.deletions}</span>
                          )}
                        </span>
                        <span
                          className={cn(
                            "w-3 shrink-0 text-center font-medium",
                            STATUS_TONE[f.status],
                          )}
                          title={f.status}
                        >
                          {STATUS_LETTER[f.status]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
          {reading && (
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
                  onViewed={viewable ? () => toggleViewed(currentFile) : undefined}
                  onList={page ? undefined : () => setListing(true)}
                />
              )}
              {current && conversations?.(current).aside}
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
                  {...fileCommenting(commenting, diff, githubCommenting)}
                  notes={current ? conversations?.(current).notes : undefined}
                />
              )}
            </div>
          )}
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
  onList,
}: {
  file: ReviewFile;
  index: number;
  count: number;
  onStep(step: -1 | 1): void;
  onViewed?: () => void;
  /** Back to the file list (the side panel). */
  onList?: () => void;
}) {
  const slash = file.path.lastIndexOf("/");
  return (
    <div className="bg-background/95 border-border sticky top-0 z-10 flex h-9 items-center gap-1 border-b px-2 text-xs backdrop-blur">
      {onList && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="All files"
          title="All files"
          onClick={onList}
        >
          <List />
        </Button>
      )}
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
