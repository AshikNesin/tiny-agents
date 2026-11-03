/**
 * The Changes panel (issue #143): what Shelley changed in the conversation's
 * working directory — the working tree and recent commits, their files with
 * +/− counts, and each file's diff. Selecting lines and pressing Comment puts
 * "`path:lines` " in the composer, so review feedback goes straight back to
 * Shelley as a steer.
 */
import { useEffect, useMemo, useState } from "react";
import { FileDiff as FileDiffIcon, RefreshCw, X } from "lucide-react";
import { Button, monoClass } from "@groot/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { cn } from "@groot/ui/lib/utils";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { shelleyApi, type GitDiff, type GitFile, type GitFileDiff } from "../../lib/shelley/api";
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
  cwd,
  refreshKey,
  onComment,
  onClose,
}: {
  cwd: string;
  /** Changes when Shelley's turn ends, to re-read the diff. */
  refreshKey: unknown;
  onComment(text: string): void;
  onClose(): void;
}) {
  const [diffs, setDiffs] = useState<GitDiff[] | null>(null);
  const [diffId, setDiffId] = useState<string>("working");
  const [files, setFiles] = useState<GitFile[] | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<GitFileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // Re-read at most every 1.5 s while Shelley works (each message bumps the key).
  const [settledKey, setSettledKey] = useState(refreshKey);
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(refreshKey), 1500);
    return () => clearTimeout(timer);
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    shelleyApi
      .diffs(cwd)
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
  }, [cwd, settledKey, reload]);

  useEffect(() => {
    if (!diffs) return;
    let cancelled = false;
    setFiles(null);
    shelleyApi
      .diffFiles(diffId, cwd)
      .then((list) => {
        if (cancelled) return;
        const rows = Array.isArray(list) ? list : [];
        setFiles(rows);
        setPath((current) =>
          current && rows.some((f) => f.path === current)
            ? current
            : ((rows.find((f) => !f.isGenerated) ?? rows[0])?.path ?? null),
        );
      })
      .catch(
        (err: unknown) => !cancelled && setError(errorMessage(err, "Could not list the files.")),
      );
    return () => {
      cancelled = true;
    };
  }, [diffs, diffId, cwd]);

  useEffect(() => {
    if (!path) {
      setFileDiff(null);
      return;
    }
    let cancelled = false;
    setFileDiff(null);
    shelleyApi
      .fileDiff(diffId, cwd, path)
      .then((d) => !cancelled && setFileDiff(d))
      .catch(
        (err: unknown) => !cancelled && setError(errorMessage(err, "Could not read the diff.")),
      );
    return () => {
      cancelled = true;
    };
  }, [diffId, cwd, path, files]);

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

  const comment = (selection: LineSelection) => {
    if (!path) return;
    const lines =
      selection.from === selection.to ? `${selection.from}` : `${selection.from}-${selection.to}`;
    onComment(`\`${path}:${lines}\` `);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-changes">
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <FileDiffIcon className="text-muted-foreground size-4 shrink-0" />
        <span className="text-sm font-medium">Changes</span>
        {files && files.length > 0 && (
          <span className="text-xs tabular-nums">
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
        >
          <RefreshCw />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close changes">
          <X />
        </Button>
      </div>

      {error ? (
        <p className="text-destructive p-3 text-sm">{error}</p>
      ) : !diffs ? (
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      ) : diffs.length === 0 ? (
        <p className="text-muted-foreground p-3 text-sm">
          Not a git repository, or nothing to show.
        </p>
      ) : (
        <>
          <div className="border-border space-y-2 border-b p-2">
            <Select value={diffId} onValueChange={(v) => setDiffId(v)}>
              <SelectTrigger size="sm" className="w-full" aria-label="Diff">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {diffs.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.id === "working"
                      ? `Working tree (${d.filesCount} ${d.filesCount === 1 ? "file" : "files"})`
                      : `${d.id.slice(0, 7)} ${d.message.split("\n")[0].slice(0, 60)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && selected.id !== "working" && (
              <p className="text-muted-foreground truncate px-1 text-xs">
                {selected.author} · {formatRelativeTime(selected.timestamp)}
                {selected.refs?.length ? ` · ${selected.refs.join(", ")}` : ""}
              </p>
            )}
            {files === null ? (
              <div className="flex justify-center p-2">
                <Spinner />
              </div>
            ) : files.length === 0 ? (
              <p className="text-muted-foreground px-1 text-xs">No changes.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto" aria-label="Changed files">
                {files.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => setPath(f.path)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs",
                        f.path === path ? "bg-muted" : "hover:bg-muted",
                        f.isGenerated && "opacity-60",
                      )}
                      aria-current={f.path === path ? "true" : undefined}
                    >
                      <span className={cn("w-3 shrink-0 font-medium", STATUS_TONE[f.status])}>
                        {STATUS_LETTER[f.status]}
                      </span>
                      <span className={cn("min-w-0 flex-1 truncate", monoClass)} title={f.path}>
                        {f.path}
                      </span>
                      {f.isGenerated && (
                        <span className="text-muted-foreground shrink-0">generated</span>
                      )}
                      <span className="text-success shrink-0 tabular-nums">+{f.additions}</span>
                      <span className="text-destructive shrink-0 tabular-nums">−{f.deletions}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {path && !fileDiff ? (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            ) : fileDiff ? (
              <>
                <p
                  className={cn(
                    "text-muted-foreground border-border border-b px-3 py-1.5 text-xs",
                    monoClass,
                  )}
                >
                  {fileDiff.path}
                </p>
                <FileDiff
                  path={fileDiff.path}
                  oldContent={fileDiff.oldContent}
                  newContent={fileDiff.newContent}
                  onComment={comment}
                />
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
