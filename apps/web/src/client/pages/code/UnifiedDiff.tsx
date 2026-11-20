import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { diffLines } from "diff";
import { FilePen, Trash2 } from "lucide-react";
import {
  parseDiffFromFile,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type SelectedLineRange,
} from "@pierre/diffs";
import { FileDiff as DiffsFileDiff, PatchDiff, type FileDiffOptions } from "@pierre/diffs/react";
import { useTheme } from "@groot/shell/lib/theme";
import { Button, Textarea } from "@groot/ui";
import { Spinner } from "../../components/ui/spinner";

export interface LineSelection {
  from: number;
  to: number;
  side: "old" | "new";
}

export type CommentTarget = "agent" | "github";

export interface LineComment {
  id: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
  body: string;
  tag?: string;
}

export interface LineNote {
  id: string;
  side: "old" | "new";
  line: number;
  node: ReactNode;
}

function suggestionBlock(lines: string): string {
  return `\`\`\`suggestion\n${lines}\n\`\`\``;
}

export function diffStats(patchText: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of patchText.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

const DIFF_TIMEOUT_MS = 1_500;

const MAX_DRAWN_ROWS = 4_000;

export function useBaseOptions() {
  const { resolvedTheme } = useTheme();
  return useMemo(
    () =>
      ({
        theme: { dark: "pierre-dark", light: "pierre-light" },
        themeType: resolvedTheme === "dark" ? "dark" : "light",
        diffStyle: "unified",
        overflow: "wrap",
        disableFileHeader: true,
        hunkSeparators: "line-info-basic",
        lineDiffType: "word",
        unsafeCSS: `:host { --diffs-font-size: 12.5px; --diffs-line-height: 20px; --diffs-bg: transparent; }`,
      }) satisfies FileDiffOptions<unknown, undefined>,
    [resolvedTheme],
  );
}

export interface Row {
  oldNo?: number;
  newNo?: number;
}

export function rowsOf(oldContent: string, newContent: string): Row[] | null {
  const changes = diffLines(oldContent, newContent, {
    timeout: DIFF_TIMEOUT_MS,
  });
  if (!changes) return null;
  const rows: Row[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const change of changes) {
    const count = change.count ?? change.value.split("\n").length - 1;
    for (let i = 0; i < count; i++) {
      if (change.added) rows.push({ newNo: newNo++ });
      else if (change.removed) rows.push({ oldNo: oldNo++ });
      else rows.push({ oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return rows;
}

export const SIDE = { old: "deletions", new: "additions" } as const;
const sideOf = (side: SelectedLineRange["side"]): "old" | "new" =>
  side === "deletions" ? "old" : "new";

export function toSelection(range: SelectedLineRange, rows: Row[]): LineSelection {
  const startSide = sideOf(range.side);
  const endSide = sideOf(range.endSide ?? range.side);
  if (startSide === endSide) {
    return {
      side: startSide,
      from: Math.min(range.start, range.end),
      to: Math.max(range.start, range.end),
    };
  }
  const at = (side: "old" | "new", no: number) =>
    rows.findIndex((r) => (side === "old" ? r.oldNo === no : r.newNo === no));
  const a = at(startSide, range.start);
  const b = at(endSide, range.end);
  const inside = rows.slice(Math.min(a, b), Math.max(a, b) + 1);
  const side = inside.some((r) => r.newNo !== undefined) ? "new" : "old";
  const nos = inside
    .map((r) => (side === "new" ? r.newNo : r.oldNo))
    .filter((n) => n !== undefined);
  return { side, from: Math.min(...nos), to: Math.max(...nos) };
}

function rangeLabel(sel: { from: number; to: number; side: "old" | "new" }): string {
  const what = sel.side === "old" ? "removed line" : "line";
  return sel.from === sel.to ? `${what} ${sel.from}` : `${what}s ${sel.from}–${sel.to}`;
}

export function Composer({
  path,
  selection,
  body,
  setBody,
  onSubmit,
  onCancel,
  reviewing,
  selected,
}: {
  path: string;
  selection: LineSelection;
  body: string;
  setBody(body: string): void;
  onSubmit(body: string, target: CommentTarget): Promise<void>;
  onCancel(): void;
  reviewing?: boolean;
  selected?: string;
}) {
  const [busy, setBusy] = useState<CommentTarget | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => box.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const submit = async (target: CommentTarget) => {
    if (!body.trim() || busy) return;
    setBusy(target);
    try {
      await onSubmit(body.trim(), target);
    } catch {
      setBusy(null);
    }
  };
  const primary: CommentTarget = reviewing ? "github" : "agent";
  return (
    <div
      className="border-border bg-background border-y px-3 py-2 font-sans [contain:inline-size]"
      data-composer
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit(primary);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        ref={box}
        rows={2}
        placeholder={reviewing ? "Leave a review comment…" : "Tell the agent what to change here…"}
        aria-label={`Comment on ${path} ${rangeLabel(selection)}`}
        className="min-h-14 text-sm"
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
          Commenting on {rangeLabel(selection)}
          <span className="pointer-coarse:hidden"> · shift-click or drag to widen</span>
        </span>
        {reviewing && selected !== undefined && (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Suggest change"
            title="Suggest change"
            className="text-muted-foreground"
            onClick={() =>
              setBody(`${body.trimEnd()}${body.trim() ? "\n\n" : ""}${suggestionBlock(selected)}`)
            }
          >
            <FilePen />
          </Button>
        )}
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {reviewing && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!body.trim() || busy !== null}
            onClick={() => void submit("agent")}
            title="Ask the assistant about these lines"
          >
            {busy === "agent" && <Spinner className="size-3" />}
            Ask assistant
          </Button>
        )}
        <Button
          type="button"
          size="xs"
          disabled={!body.trim() || busy !== null}
          onClick={() => void submit(primary)}
          title={reviewing ? "Add to your review (⌘↵)" : "Comment (⌘↵)"}
        >
          {busy === primary && <Spinner className="size-3" />}
          Comment
        </Button>
      </div>
    </div>
  );
}

export function SavedComment({
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
      className="border-border bg-muted/40 flex items-start gap-2 border-y px-3 py-2 font-sans text-sm [contain:inline-size]"
    >
      <span className="bg-primary/70 mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden />
      <p className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{comment.body}</p>
      <span className="text-muted-foreground shrink-0 pt-0.5 text-xs">
        {comment.tag ?? "Not sent"}
      </span>
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

function withHeaders(patch: string, path: string): string {
  return /^(---|diff --git) /m.test(patch) ? patch : `--- a/${path}\n+++ b/${path}\n${patch}`;
}

export function PatchView({
  patch,
  path = "file",
  className,
}: {
  patch: string;
  path?: string;
  className?: string;
}) {
  const options = useBaseOptions();
  if (!/^@@ /m.test(patch)) {
    return (
      <p className="text-muted-foreground px-3 py-2 text-xs">
        No changes (the file already had this content).
      </p>
    );
  }
  return (
    <div className={className} data-testid="patch-diff">
      <PatchDiff patch={withHeaders(patch, path)} options={options} />
    </div>
  );
}

export const UNSHOWABLE_TEXT = {
  binary: "Binary file. Its contents are not shown.",
  tooLarge: "This file is too large to show here (over 2 MB).",
} as const;

type Note =
  | { kind: "comment"; comment: LineComment }
  | { kind: "composer" }
  | { kind: "note"; id: string };

export function FileDiff({
  path,
  oldContent,
  newContent,
  unshowable,
  onComment,
  comments,
  onRemoveComment,
  reviewing,
  notes,
}: {
  path: string;
  oldContent: string;
  newContent: string;
  unshowable?: keyof typeof UNSHOWABLE_TEXT;
  onComment?(selection: LineSelection, body: string, target: CommentTarget): Promise<void> | void;
  comments?: LineComment[];
  onRemoveComment?(id: string): void;
  reviewing?: boolean;
  notes?: LineNote[];
}) {
  const base = useBaseOptions();
  const all = useMemo(
    () => (unshowable ? null : rowsOf(oldContent, newContent)),
    [oldContent, newContent, unshowable],
  );
  const hidden = all ? all.length - MAX_DRAWN_ROWS : 0;
  const rows = hidden > 0 ? all!.slice(0, MAX_DRAWN_ROWS) : all;
  const fileDiff = useMemo<FileDiffMetadata | null>(() => {
    if (!all) return null;
    const drawn = all.slice(0, MAX_DRAWN_ROWS);
    const upTo = (content: string, key: keyof Row) => {
      if (drawn.length === all.length) return content;
      const last = drawn.findLast((r) => r[key] !== undefined)?.[key] ?? 0;
      return content.split("\n").slice(0, last).join("\n") + (last ? "\n" : "");
    };
    return parseDiffFromFile(
      { name: path, contents: upTo(oldContent, "oldNo") },
      { name: path, contents: upTo(newContent, "newNo") },
    );
  }, [all, path, oldContent, newContent]);
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState("");
  const current = useRef(selection);
  useEffect(() => {
    current.current = selection;
  }, [selection]);

  const options = useMemo<FileDiffOptions<Note, undefined>>(() => {
    if (!onComment || !rows) return base;
    const take = (range: SelectedLineRange | null) => {
      if (!range) return;
      const next = toSelection(range, rows);
      const prev = current.current;
      const widened =
        prev && prev.side === next.side && next.from <= prev.from && next.to >= prev.to;
      if (!widened) setDraft("");
      current.current = next;
      setSelection(next);
    };
    return {
      ...base,
      enableLineSelection: true,
      onLineSelectionStart: () => setDragging(true),
      onLineSelectionChange: take,
      onLineSelectionEnd: (range) => {
        take(range);
        setDragging(false);
      },
    };
  }, [base, onComment, rows]);

  const noteNodes = useMemo(() => new Map(notes?.map((n) => [n.id, n.node])), [notes]);
  const lineAnnotations = useMemo<DiffLineAnnotation<Note>[]>(() => {
    const extra: DiffLineAnnotation<Note>[] = (notes ?? []).map((n) => ({
      side: SIDE[n.side],
      lineNumber: n.line,
      metadata: { kind: "note", id: n.id },
    }));
    if (!onComment) return extra;
    const all: DiffLineAnnotation<Note>[] = (comments ?? []).map((comment) => ({
      side: SIDE[comment.side],
      lineNumber: comment.endLine,
      metadata: { kind: "comment", comment },
    }));
    all.push(...extra);
    if (selection && !dragging) {
      all.push({
        side: SIDE[selection.side],
        lineNumber: selection.to,
        metadata: { kind: "composer" },
      });
    }
    return all;
  }, [onComment, comments, notes, selection, dragging]);

  if (unshowable) {
    return <p className="text-muted-foreground p-4 text-sm">{UNSHOWABLE_TEXT[unshowable]}</p>;
  }
  if (!rows || !fileDiff) {
    return (
      <p className="text-muted-foreground p-4 text-sm">This diff is too large to work out here.</p>
    );
  }
  if (!rows.some((r) => r.oldNo === undefined || r.newNo === undefined)) {
    return <p className="text-muted-foreground p-4 text-sm">No textual changes.</p>;
  }
  return (
    <>
      <DiffsFileDiff<Note>
        fileDiff={fileDiff}
        options={options}
        lineAnnotations={lineAnnotations}
        selectedLines={
          selection
            ? {
                start: selection.from,
                end: selection.to,
                side: SIDE[selection.side],
              }
            : null
        }
        renderAnnotation={({ metadata }) =>
          metadata.kind === "note" ? (
            noteNodes.get(metadata.id)
          ) : metadata.kind === "comment" ? (
            <SavedComment comment={metadata.comment} onRemove={onRemoveComment} />
          ) : (
            selection &&
            onComment && (
              <Composer
                path={path}
                selection={selection}
                body={draft}
                setBody={setDraft}
                onCancel={() => setSelection(null)}
                reviewing={reviewing}
                selected={
                  selection.side === "new"
                    ? newContent
                        .split("\n")
                        .slice(selection.from - 1, selection.to)
                        .join("\n")
                    : undefined
                }
                onSubmit={async (text, target) => {
                  await onComment(selection, text, target);
                  setSelection(null);
                  setDraft("");
                }}
              />
            )
          )
        }
      />
      {hidden > 0 && (
        <p className="text-muted-foreground border-border border-t px-3 py-2 text-xs">
          {hidden.toLocaleString()} more lines not shown.
        </p>
      )}
    </>
  );
}
