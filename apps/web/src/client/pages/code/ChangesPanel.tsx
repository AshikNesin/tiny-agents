/**
 * The Changes panel (issue #143, ADR 0011): what the agent changed in the thread's
 * working directory — uncommitted changes or a recent commit (searchable),
 * every changed file as a card with its +/− and its diff, stacked in one
 * scroll (generated files folded). Selecting lines and pressing Comment puts
 * "`path:lines` " in the composer, so review feedback goes straight back to
 * the agent as a steer. Diffs come from the thread's harness (capability
 * `workspace.diffs`).
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileDiff as FileDiffIcon, RefreshCw, X } from "lucide-react";
import { Button, EmptyState, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import { SearchSelect, type SearchSelectOption } from "../../components/ui/search-select";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { codeApi, type GitDiff, type GitFile, type GitFileDiff } from "../../lib/code/api";
import { FileDiff, type LineSelection } from "./UnifiedDiff";

const STATUS_LETTER: Record<GitFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};
const STATUS_TONE: Record<GitFile["status"], string> = {
  added: "text-success",
  modified: "text-warning",
  deleted: "text-destructive",
};

export function ChangesPanel({
  instanceId,
  cwd,
  refreshKey,
  onComment,
  onClose,
}: {
  instanceId: string;
  cwd: string;
  /** Changes when the agent's turn ends, to re-read the diff. */
  refreshKey: unknown;
  onComment(text: string): void;
  onClose(): void;
}) {
  const [diffs, setDiffs] = useState<GitDiff[] | null>(null);
  const [diffId, setDiffId] = useState<string>("working");
  // The files of the scope they were read for: a re-read of the same scope
  // swaps them in place, so the list (and what was folded) never blinks out.
  const [listed, setListed] = useState<{ diffId: string; files: GitFile[] } | null>(null);
  const files = listed?.diffId === diffId ? listed.files : null;
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // Re-read at most every 1.5 s while the agent works (each message bumps the key).
  const [settledKey, setSettledKey] = useState(refreshKey);
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(refreshKey), 1500);
    return () => clearTimeout(timer);
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    codeApi
      .diffs(instanceId, cwd)
      .then((r) => {
        if (cancelled) return;
        const list = r.diffs ?? [];
        setDiffs(list);
        setDiffId((current) => {
          if (list.some((d) => d.id === current && (d.id !== "working" || d.filesCount > 0)))
            return current;
          const working = list.find((d) => d.id === "working" && d.filesCount > 0);
          return working?.id ?? list.find((d) => d.id !== "working")?.id ?? "working";
        });
      })
      .catch(
        (err: unknown) => !cancelled && setError(errorMessage(err, "Could not read the changes.")),
      );
    return () => {
      cancelled = true;
    };
  }, [instanceId, cwd, settledKey, reload]);

  useEffect(() => {
    if (!diffs) return;
    let cancelled = false;
    codeApi
      .diffFiles(instanceId, diffId, cwd)
      .then((list) => {
        if (cancelled) return;
        setError(null);
        setListed({ diffId, files: Array.isArray(list) ? list : [] });
      })
      .catch(
        (err: unknown) => !cancelled && setError(errorMessage(err, "Could not list the files.")),
      );
    return () => {
      cancelled = true;
    };
  }, [instanceId, diffs, diffId, cwd]);

  const selected = diffs?.find((d) => d.id === diffId);
  const totals = useMemo(
    () =>
      (files ?? []).reduce(
        (sum, f) => ({
          additions: sum.additions + f.additions,
          deletions: sum.deletions + f.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );
  // Open the first few real files; generated ones (lockfiles) start folded.
  const openByDefault = useMemo(() => {
    const real = (files ?? []).filter((f) => !f.isGenerated);
    return new Set(real.slice(0, 6).map((f) => f.path));
  }, [files]);

  const diffOptions: SearchSelectOption[] = (diffs ?? []).map((d) => ({
    value: d.id,
    label:
      d.id === "working"
        ? "Uncommitted changes"
        : d.message.split("\n")[0].slice(0, 80) || d.id.slice(0, 7),
    description:
      d.id === "working"
        ? `${d.filesCount} ${d.filesCount === 1 ? "file" : "files"}`
        : `${d.id.slice(0, 7)} · ${d.author} · ${formatRelativeTime(d.timestamp)}${d.refs?.length ? ` · ${d.refs.join(", ")}` : ""}`,
    keywords: [d.id, d.author],
    group: d.id === "working" ? undefined : "Commits",
  }));

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-changes">
      <div className="border-border flex h-13 shrink-0 items-center gap-1 border-b px-2">
        {diffs && diffs.length > 0 ? (
          <SearchSelect
            label="Changes to show"
            value={diffId}
            onValueChange={setDiffId}
            options={diffOptions}
            searchPlaceholder="Search commits…"
            contentClassName="w-96"
            triggerClassName="text-foreground h-8 text-sm"
            data-testid="code-diff-select"
          >
            <FileDiffIcon className="text-muted-foreground size-4" />
            <span className="max-w-64 truncate">
              {diffId === "working"
                ? "Uncommitted changes"
                : (selected?.message.split("\n")[0] ?? diffId.slice(0, 7))}
            </span>
            <ChevronDown className="opacity-50" />
          </SearchSelect>
        ) : (
          <span className="flex items-center gap-2 px-2 text-sm font-medium">
            <FileDiffIcon className="text-muted-foreground size-4" />
            Changes
          </span>
        )}
        {files && files.length > 0 && (
          <span className="text-muted-foreground shrink-0 px-1 text-xs tabular-nums">
            {files.length} {files.length === 1 ? "file" : "files"}{" "}
            <span className="text-success">+{totals.additions}</span>{" "}
            <span className="text-destructive">−{totals.deletions}</span>
          </span>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setReload((n) => n + 1)}
          aria-label="Refresh changes"
          title="Refresh"
          className="text-muted-foreground"
        >
          <RefreshCw />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close changes"
          title="Close (⌘⇧D)"
          className="text-muted-foreground"
        >
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && files ? (
          <p className="text-destructive px-1 pb-2 text-xs">{error} Showing the last read.</p>
        ) : null}
        {error && !files ? (
          <p className="text-destructive p-1 text-sm">{error}</p>
        ) : !diffs || (files === null && diffs.length > 0) ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : diffs.length === 0 ? (
          <EmptyState
            icon={FileDiffIcon}
            title="Nothing to show"
            description="Not a git repository, or no commits yet."
          />
        ) : files && files.length === 0 ? (
          <EmptyState
            icon={FileDiffIcon}
            title="No changes"
            description="The working tree is clean. Pick a commit above to review it."
          />
        ) : (
          <ul className="space-y-3" aria-label="Changed files">
            {(files ?? []).map((file) => (
              <FileCard
                key={`${diffId}:${file.path}`}
                file={file}
                diffId={diffId}
                instanceId={instanceId}
                cwd={cwd}
                defaultOpen={openByDefault.has(file.path)}
                reload={`${settledKey}:${reload}`}
                onComment={(selection) => {
                  const lines =
                    selection.from === selection.to
                      ? `${selection.from}`
                      : `${selection.from}-${selection.to}`;
                  onComment(`\`${file.path}:${lines}\` `);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One changed file: a sticky header (status, path, +/−) over its diff, read when opened. */
function FileCard({
  file,
  diffId,
  instanceId,
  cwd,
  defaultOpen,
  reload,
  onComment,
}: {
  file: GitFile;
  diffId: string;
  instanceId: string;
  cwd: string;
  defaultOpen: boolean;
  reload: string;
  onComment(selection: LineSelection): void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [diff, setDiff] = useState<GitFileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    codeApi
      .fileDiff(instanceId, diffId, cwd, file.path)
      .then((d) => !cancelled && setDiff(d))
      .catch(
        (err: unknown) => !cancelled && setError(errorMessage(err, "Could not read the diff.")),
      );
    return () => {
      cancelled = true;
    };
  }, [open, instanceId, diffId, cwd, file.path, file.additions, file.deletions, reload]);

  const slash = file.path.lastIndexOf("/");
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
  const name = file.path.slice(slash + 1);

  return (
    <li className="ring-foreground/10 overflow-clip rounded-xl ring-1" data-testid="code-file">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "bg-card hover:bg-muted sticky top-0 z-10 flex h-9 w-full min-w-0 items-center gap-2 px-3 text-left text-xs",
          open && "border-border border-b",
        )}
        title={file.path}
      >
        <ChevronRight
          className={cn(
            "text-muted-foreground size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <span className={cn("w-3 shrink-0 font-medium", STATUS_TONE[file.status])}>
          {STATUS_LETTER[file.status]}
        </span>
        <span className={cn("flex min-w-0 flex-1", monoClass)}>
          <span className="text-muted-foreground truncate">{dir}</span>
          <span className="shrink-0">{name}</span>
        </span>
        {file.isGenerated && <span className="text-muted-foreground shrink-0">generated</span>}
        {file.binary && <span className="text-muted-foreground shrink-0">binary</span>}
        <span className="text-success shrink-0 tabular-nums">+{file.additions}</span>
        <span className="text-destructive shrink-0 tabular-nums">−{file.deletions}</span>
      </button>
      {open &&
        (error ? (
          <p className="text-destructive p-3 text-xs">{error}</p>
        ) : !diff ? (
          <div className="flex justify-center p-3">
            <Spinner className="size-4" />
          </div>
        ) : (
          <FileDiff
            path={diff.path}
            oldContent={diff.oldContent}
            newContent={diff.newContent}
            unshowable={diff.unshowable}
            onComment={onComment}
          />
        ))}
    </li>
  );
}
