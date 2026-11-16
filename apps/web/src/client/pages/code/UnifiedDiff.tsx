/**
 * Diff rendering for the Code page (issue #143), in one place so the diff
 * library can be swapped without touching its callers: `PatchView` renders a
 * unified diff (Shelley's `patch` tool output), `FileDiff` an old/new pair
 * (the Changes panel), with optional line selection for comments.
 *
 * Today this renders with jsdiff (`diff`); the agreed renderer is
 * @pierre/diffs (diffs.com), pending a supply-chain exception for its
 * `@pierre/theme@2.0.0` dependency (see the PR notes).
 */
import { useMemo, useState } from "react";
import { createTwoFilesPatch, parsePatch } from "diff";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";

export interface DiffLine {
  kind: "add" | "del" | "context" | "hunk" | "meta";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Unified diff text → display lines with line numbers. */
function parseUnified(patchText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let parsed: ReturnType<typeof parsePatch>;
  try {
    parsed = parsePatch(patchText);
  } catch {
    return patchText.split("\n").map((text) => ({ kind: "context", text }));
  }
  for (const file of parsed) {
    for (const hunk of file.hunks) {
      lines.push({
        kind: "hunk",
        text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      });
      let oldNo = hunk.oldStart;
      let newNo = hunk.newStart;
      for (const raw of hunk.lines) {
        const sign = raw[0];
        const text = raw.slice(1);
        if (sign === "+") lines.push({ kind: "add", text, newNo: newNo++ });
        else if (sign === "-") lines.push({ kind: "del", text, oldNo: oldNo++ });
        else if (sign === "\\") lines.push({ kind: "meta", text: raw });
        else lines.push({ kind: "context", text, oldNo: oldNo++, newNo: newNo++ });
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

export interface LineSelection {
  /** New-file line numbers (old for deleted lines), inclusive. */
  from: number;
  to: number;
}

function DiffLines({
  lines,
  onComment,
  className,
}: {
  lines: DiffLine[];
  /** Enables line selection and a "Comment" action for the selected range. */
  onComment?: (selection: LineSelection) => void;
  className?: string;
}) {
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const lineNo = (line: DiffLine) => line.newNo ?? line.oldNo;
  const selected = (line: DiffLine) => {
    const n = lineNo(line);
    return selection !== null && n !== undefined && n >= selection.from && n <= selection.to;
  };
  const pick = (line: DiffLine, extend: boolean) => {
    const n = lineNo(line);
    if (n === undefined || !onComment) return;
    setSelection((prev) =>
      extend && prev
        ? { from: Math.min(prev.from, n), to: Math.max(prev.to, n) }
        : { from: n, to: n },
    );
  };
  return (
    <div className={cn("overflow-x-auto font-mono text-[12.5px] leading-5", className)}>
      <div className="min-w-fit">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn("group flex", ROW[line.kind], selected(line) && "bg-primary/15")}
            data-kind={line.kind}
          >
            {line.kind === "hunk" || line.kind === "meta" ? (
              <span className="px-3 py-0.5 whitespace-pre">{line.text}</span>
            ) : (
              <>
                <button
                  type="button"
                  tabIndex={onComment ? 0 : -1}
                  disabled={!onComment}
                  onClick={(event) => pick(line, event.shiftKey)}
                  className={cn(
                    "text-muted-foreground w-10 shrink-0 pr-2 text-right tabular-nums select-none",
                    onComment && "hover:text-foreground cursor-pointer",
                  )}
                  aria-label={onComment ? `Select line ${lineNo(line)}` : undefined}
                >
                  {line.oldNo ?? ""}
                </button>
                <span className="text-muted-foreground w-10 shrink-0 pr-2 text-right tabular-nums select-none">
                  {line.newNo ?? ""}
                </span>
                <span className="text-muted-foreground w-4 shrink-0 select-none">
                  {SIGN[line.kind]}
                </span>
                <span className="pr-4 whitespace-pre">{line.text || " "}</span>
              </>
            )}
          </div>
        ))}
      </div>
      {selection && onComment && (
        <div className="bg-background/95 border-border sticky bottom-0 flex items-center gap-2 border-t px-3 py-1.5 font-sans">
          <span className="text-muted-foreground text-xs">
            {selection.from === selection.to
              ? `Line ${selection.from}`
              : `Lines ${selection.from}–${selection.to}`}{" "}
            · shift-click to extend
          </span>
          <Button
            size="xs"
            className="ml-auto"
            onClick={() => {
              onComment(selection);
              setSelection(null);
            }}
          >
            <MessageSquarePlus />
            Comment
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setSelection(null)}>
            Clear
          </Button>
        </div>
      )}
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
  return <DiffLines lines={lines} className={className} />;
}

/** Diff lines drawn at most; a longer diff says how many it left out. */
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
}: {
  path: string;
  oldContent: string;
  newContent: string;
  /** The server could not send this file as text: say why. */
  unshowable?: keyof typeof UNSHOWABLE_TEXT;
  onComment?: (selection: LineSelection) => void;
}) {
  const lines = useMemo(() => {
    if (unshowable) return null;
    const patch = createTwoFilesPatch(path, path, oldContent, newContent, "", "", {
      context: 3,
      timeout: DIFF_TIMEOUT_MS,
    });
    return patch === undefined ? null : parseUnified(patch);
  }, [path, oldContent, newContent, unshowable]);
  if (unshowable) {
    return <p className="text-muted-foreground p-4 text-sm">{UNSHOWABLE_TEXT[unshowable]}</p>;
  }
  if (lines === null) {
    return (
      <p className="text-muted-foreground p-4 text-sm">This diff is too large to work out here.</p>
    );
  }
  if (lines.length === 0) {
    return <p className="text-muted-foreground p-4 text-sm">No textual changes.</p>;
  }
  const hidden = lines.length - MAX_DRAWN_LINES;
  return (
    <>
      <DiffLines
        lines={hidden > 0 ? lines.slice(0, MAX_DRAWN_LINES) : lines}
        onComment={onComment}
      />
      {hidden > 0 && (
        <p className="text-muted-foreground border-border border-t px-3 py-2 text-xs">
          {hidden.toLocaleString()} more lines not shown.
        </p>
      )}
    </>
  );
}
