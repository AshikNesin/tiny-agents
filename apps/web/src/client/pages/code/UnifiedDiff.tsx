/**
 * Diff rendering for the Code page (issue #143), in one place so the diff
 * library can be swapped without touching its callers: `PatchView` renders a
 * unified diff (Shelley's `patch` tool output), `FileDiff` an old/new pair
 * (the Changes and Review panels).
 *
 * A `FileDiff` reads like a review: one line-number gutter, long lines
 * wrapped, unchanged runs folded into "Show N more lines", and, when the
 * caller takes comments, a Comment button in each line's gutter that opens a
 * composer right under that line (shift-click another line to widen the
 * range). Saved comments stay under their lines until they are sent.
 *
 * Today this renders with jsdiff (`diff`); the agreed renderer is
 * @pierre/diffs (diffs.com), pending a supply-chain exception for its
 * `@pierre/theme@2.0.0` dependency (see the PR notes).
 */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { diffLines, parsePatch } from "diff";
import { Plus, Trash2, UnfoldVertical } from "lucide-react";
import { Button, Textarea } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";

export interface DiffLine {
  /** Its position in the diff, a stable key while the content stays the same. */
  id: number;
  kind: "add" | "del" | "context" | "hunk" | "meta";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Lines commented on: new-file numbers, or old-file ones for removed lines. */
interface LineSelection {
  from: number;
  to: number;
  side: "old" | "new";
}

/** A saved comment, drawn under the last line it covers. */
export interface LineComment {
  id: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
  body: string;
}

/** Unified diff text → display lines with line numbers. */
function parseUnified(patchText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let parsed: ReturnType<typeof parsePatch>;
  try {
    parsed = parsePatch(patchText);
  } catch {
    return patchText.split("\n").map((text, id) => ({ id, kind: "context", text }));
  }
  for (const file of parsed) {
    for (const hunk of file.hunks) {
      lines.push({
        id: lines.length,
        kind: "hunk",
        text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      });
      let oldNo = hunk.oldStart;
      let newNo = hunk.newStart;
      for (const raw of hunk.lines) {
        const sign = raw[0];
        const text = raw.slice(1);
        if (sign === "+") lines.push({ id: lines.length, kind: "add", text, newNo: newNo++ });
        else if (sign === "-") lines.push({ id: lines.length, kind: "del", text, oldNo: oldNo++ });
        else if (sign === "\\") lines.push({ id: lines.length, kind: "meta", text: raw });
        else
          lines.push({ id: lines.length, kind: "context", text, oldNo: oldNo++, newNo: newNo++ });
      }
    }
  }
  return lines;
}

/** +added / −removed counts of a unified diff. */
export function diffStats(patchText: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patchText.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

/** Unchanged lines kept on each side of a change; longer runs fold. */
const CONTEXT = 3;

/** A diff row: a line, or a folded run of unchanged lines (keyed by its first line's index). */
type Row = DiffLine | { kind: "gap"; at: number; lines: DiffLine[] };

/** Every line of old → new, numbered; null when diffing took too long. */
function fullDiff(oldContent: string, newContent: string): DiffLine[] | null {
  const changes = diffLines(oldContent, newContent, { timeout: DIFF_TIMEOUT_MS });
  if (!changes) return null;
  const lines: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const change of changes) {
    const texts = change.value.split("\n");
    if (texts[texts.length - 1] === "") texts.pop();
    for (const text of texts) {
      if (change.added) lines.push({ id: lines.length, kind: "add", text, newNo: newNo++ });
      else if (change.removed) lines.push({ id: lines.length, kind: "del", text, oldNo: oldNo++ });
      else lines.push({ id: lines.length, kind: "context", text, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return lines;
}

/** Fold each unchanged run longer than its kept context into a gap, unless opened. */
function foldContext(lines: DiffLine[], opened: ReadonlySet<number>): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== "context") {
      rows.push(lines[i]!);
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end]!.kind === "context") end++;
    const keepBefore = i === 0 ? 0 : CONTEXT;
    const keepAfter = end === lines.length ? 0 : CONTEXT;
    const from = i + keepBefore;
    const to = end - keepAfter;
    if (to - from > 0 && !opened.has(from)) {
      rows.push(...lines.slice(i, from));
      rows.push({ kind: "gap", at: from, lines: lines.slice(from, to) });
      rows.push(...lines.slice(to, end));
    } else {
      rows.push(...lines.slice(i, end));
    }
    i = end;
  }
  return rows;
}

const ROW: Record<DiffLine["kind"], string> = {
  add: "bg-success/10",
  del: "bg-destructive/10",
  context: "",
  hunk: "bg-muted text-muted-foreground",
  meta: "text-muted-foreground",
};

const SIGN: Record<DiffLine["kind"], string> = {
  add: "+",
  del: "−",
  context: " ",
  hunk: "",
  meta: "",
};

/** The side and number a line is commented on by (removed lines by their old number). */
function anchor(line: DiffLine): { side: "old" | "new"; no: number } | null {
  if (line.kind === "del") return line.oldNo === undefined ? null : { side: "old", no: line.oldNo };
  if (line.kind === "add" || line.kind === "context")
    return line.newNo === undefined ? null : { side: "new", no: line.newNo };
  return null;
}

function rangeLabel(sel: { from: number; to: number; side: "old" | "new" }): string {
  const what = sel.side === "old" ? "removed line" : "line";
  return sel.from === sel.to ? `${what} ${sel.from}` : `${what}s ${sel.from}–${sel.to}`;
}

/** Comments on a file: take new ones, and show the saved ones in place. */
export interface Commenting {
  path: string;
  onComment(selection: LineSelection, body: string): Promise<void> | void;
  comments?: LineComment[];
  onRemoveComment?(id: string): void;
}

function Composer({
  path,
  selection,
  onSubmit,
  onCancel,
}: {
  path: string;
  selection: LineSelection;
  onSubmit(body: string): Promise<void>;
  onCancel(): void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(body.trim());
    } catch {
      // The caller says what went wrong; the text stays to try again.
      setBusy(false);
    }
  };
  return (
    <div className="border-border bg-background border-y px-3 py-2 font-sans" data-composer>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        autoFocus
        rows={2}
        placeholder="Tell the agent what to change here…"
        aria-label={`Comment on ${path} ${rangeLabel(selection)}`}
        className="min-h-14 text-sm"
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
          Commenting on {rangeLabel(selection)}
          <span className="pointer-coarse:hidden"> · shift-click a line to widen</span>
        </span>
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="xs"
          disabled={!body.trim() || busy}
          onClick={() => void submit()}
          title="Comment (⌘↵)"
        >
          {busy && <Spinner className="size-3" />}
          Comment
        </Button>
      </div>
    </div>
  );
}

function SavedComment({
  comment,
  onRemove,
}: {
  comment: LineComment;
  onRemove?: (id: string) => void;
}) {
  const label = `Comment on ${rangeLabel({ from: comment.startLine, to: comment.endLine, side: comment.side })}`;
  return (
    <div
      role="note"
      aria-label={label}
      className="border-border bg-muted/40 flex items-start gap-2 border-y px-3 py-2 font-sans text-sm"
    >
      <span className="bg-primary/70 mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden />
      <p className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{comment.body}</p>
      <span className="text-muted-foreground shrink-0 pt-0.5 text-xs">Not sent</span>
      {onRemove && (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Remove comment"
          title="Remove comment"
          className="text-muted-foreground"
          onClick={() => onRemove(comment.id)}
        >
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

function DiffRows({
  rows,
  commenting,
  onOpenGap,
  className,
}: {
  rows: Row[];
  commenting?: Commenting;
  onOpenGap?(at: number): void;
  className?: string;
}) {
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const pick = (line: DiffLine, extend: boolean) => {
    const at = anchor(line);
    if (!at) return;
    setSelection((prev) =>
      extend && prev && prev.side === at.side
        ? { side: at.side, from: Math.min(prev.from, at.no), to: Math.max(prev.to, at.no) }
        : { side: at.side, from: at.no, to: at.no },
    );
  };
  const inSelection = (line: DiffLine) => {
    const at = anchor(line);
    return (
      selection !== null &&
      at !== null &&
      at.side === selection.side &&
      at.no >= selection.from &&
      at.no <= selection.to
    );
  };

  // Saved comments go under the last line they cover; any whose line is not
  // on screen (folded, or the file moved on) are listed at the end.
  const saved = commenting?.comments ?? [];
  const placed = new Set<string>();
  const commentsAfter = (line: DiffLine): LineComment[] => {
    const at = anchor(line);
    if (!at) return [];
    const here = saved.filter((c) => c.side === at.side && c.endLine === at.no);
    here.forEach((c) => placed.add(c.id));
    return here;
  };

  const body: ReactNode[] = rows.map((row) => {
    if (row.kind === "gap") {
      return (
        <button
          key={`gap:${row.at}`}
          type="button"
          data-kind="gap"
          onClick={() => onOpenGap?.(row.at)}
          className="bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted flex w-full items-center gap-2 px-3 py-1 text-left font-sans text-xs"
        >
          <UnfoldVertical className="size-3.5" aria-hidden />
          Show {row.lines.length} more {row.lines.length === 1 ? "line" : "lines"}
        </button>
      );
    }
    if (row.kind === "hunk" || row.kind === "meta") {
      return (
        <div key={row.id} className={cn("flex", ROW[row.kind])} data-kind={row.kind}>
          <span className="px-3 py-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {row.text}
          </span>
        </div>
      );
    }
    const at = anchor(row);
    const composerHere =
      commenting && selection && at && at.side === selection.side && at.no === selection.to;
    return (
      <Fragment key={row.id}>
        <div
          className={cn("group/line flex", ROW[row.kind], inSelection(row) && "bg-primary/15")}
          data-kind={row.kind}
        >
          <span className="text-muted-foreground relative w-12 shrink-0 pr-2 text-right tabular-nums select-none">
            {commenting && at && (
              <button
                type="button"
                onClick={(event) => pick(row, event.shiftKey)}
                aria-label={`Comment on ${rangeLabel({ from: at.no, to: at.no, side: at.side })}`}
                title="Comment (shift-click to widen)"
                className="bg-primary text-primary-foreground absolute top-0.5 left-0.5 flex size-4 items-center justify-center rounded opacity-0 group-hover/line:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-40"
              >
                <Plus className="size-3" />
              </button>
            )}
            {row.newNo ?? row.oldNo ?? ""}
          </span>
          <span className="text-muted-foreground w-4 shrink-0 select-none">{SIGN[row.kind]}</span>
          <span className="min-w-0 flex-1 pr-4 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {row.text || " "}
          </span>
        </div>
        {commenting &&
          commentsAfter(row).map((c) => (
            <SavedComment key={c.id} comment={c} onRemove={commenting.onRemoveComment} />
          ))}
        {composerHere && (
          <Composer
            key={`${selection.side}:${selection.from}`}
            path={commenting.path}
            selection={selection}
            onCancel={() => setSelection(null)}
            onSubmit={async (text) => {
              await commenting.onComment(selection, text);
              setSelection(null);
            }}
          />
        )}
      </Fragment>
    );
  });
  const unplaced = saved.filter((c) => !placed.has(c.id));

  return (
    <div className={cn("font-mono text-[12.5px] leading-5", className)}>
      {body}
      {commenting &&
        unplaced.map((c) => (
          <SavedComment key={c.id} comment={c} onRemove={commenting.onRemoveComment} />
        ))}
    </div>
  );
}

/** A unified diff (Shelley's `patch` tool result). */
export function PatchView({ patch, className }: { patch: string; className?: string }) {
  const lines = useMemo(() => parseUnified(patch), [patch]);
  if (lines.length === 0) {
    return (
      <p className="text-muted-foreground px-3 py-2 text-xs">
        No changes (the file already had this content).
      </p>
    );
  }
  return <DiffRows rows={lines} className={className} />;
}

/** Diff rows drawn at most; a longer diff says how many it left out. */
const MAX_DRAWN_LINES = 4_000;

/** Give up diffing after this long rather than freeze the tab. */
const DIFF_TIMEOUT_MS = 1_500;

const UNSHOWABLE_TEXT = {
  binary: "Binary file. Its contents are not shown.",
  tooLarge: "This file is too large to show here (over 2 MB).",
} as const;

/** One file's old → new contents (the Changes and Review panels). */
export function FileDiff({
  path,
  oldContent,
  newContent,
  unshowable,
  onComment,
  comments,
  onRemoveComment,
}: {
  path: string;
  oldContent: string;
  newContent: string;
  /** The server could not send this file as text: say why. */
  unshowable?: keyof typeof UNSHOWABLE_TEXT;
  /** Takes comments on lines: each line's gutter offers Comment. */
  onComment?: Commenting["onComment"];
  /** Saved, unsent comments on this file, shown under their lines. */
  comments?: LineComment[];
  onRemoveComment?(id: string): void;
}) {
  const lines = useMemo(
    () => (unshowable ? null : fullDiff(oldContent, newContent)),
    [oldContent, newContent, unshowable],
  );
  // Folded runs opened by hand, by the index of their first line.
  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set());
  const rows = useMemo(() => (lines ? foldContext(lines, opened) : null), [lines, opened]);
  if (unshowable) {
    return <p className="text-muted-foreground p-4 text-sm">{UNSHOWABLE_TEXT[unshowable]}</p>;
  }
  if (rows === null) {
    return (
      <p className="text-muted-foreground p-4 text-sm">This diff is too large to work out here.</p>
    );
  }
  if (!lines!.some((l) => l.kind !== "context")) {
    return <p className="text-muted-foreground p-4 text-sm">No textual changes.</p>;
  }
  const hidden = rows.length - MAX_DRAWN_LINES;
  return (
    <>
      <DiffRows
        rows={hidden > 0 ? rows.slice(0, MAX_DRAWN_LINES) : rows}
        commenting={onComment ? { path, onComment, comments, onRemoveComment } : undefined}
        onOpenGap={(at) => setOpened((prev) => new Set(prev).add(at))}
      />
      {hidden > 0 && (
        <p className="text-muted-foreground border-border border-t px-3 py-2 text-xs">
          {hidden.toLocaleString()} more lines not shown.
        </p>
      )}
    </>
  );
}
