/**
 * A PR review's changes, laid out like a code host's review screen: a file
 * tree on the left (Files and Comments, with search, a status filter and the
 * totals) and every changed file in one scrolling column of diffs, each under
 * a sticky header with its fold, Viewed and Edit. Built on @pierre/trees
 * (`FileTree`) and @pierre/diffs (`CodeView`, which draws only the files in
 * view).
 *
 * A file's two sides are read as it is unfolded (a few at a time); generated
 * and viewed files start folded. Select line numbers, or the + beside a line,
 * to comment: Comment adds it to the PR's review on GitHub (sent with Submit
 * review), Ask assistant keeps it for the assistant. GitHub's conversations
 * sit under their lines; the Comments tab lists them all, with the comments
 * waiting to be sent.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Files,
  FileDiff as FileDiffIcon,
  ListFilter,
  MessagesSquare,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Checkbox, EmptyState, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import {
  parseDiffFromFile,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type SelectedLineRange,
} from "@pierre/diffs";
import { CodeView, type CodeViewHandle, type CodeViewReactOptions } from "@pierre/diffs/react";
import type { CodeViewDiffItem } from "@pierre/diffs";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { GitStatusEntry } from "@pierre/trees";
import { SearchSelect } from "../../components/ui/search-select";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import { fileCommenting, type ThreadCommenting } from "../../lib/code/comments";
import { useSteadyKey } from "../../lib/code/use-live-changes";
import type { PullReviewView, ReviewFile, ReviewFileDiff } from "../../../shared/api/code";
import type { FileConversations } from "./PullThreads";
import { FileListPane } from "./ResizablePane";
import { LightEditor } from "./LightEditor";
import {
  Composer,
  SavedComment,
  SIDE,
  UNSHOWABLE_TEXT,
  rowsOf,
  toSelection,
  useBaseOptions,
  type CommentTarget,
  type LineComment,
  type LineSelection,
  type Row,
} from "./UnifiedDiff";

/** `base` (the whole PR), `review` (since the owner's last review) or `mine` (Your changes). */
type Scope = "base" | "review" | "mine";

export type DiffStyle = "split" | "unified";

const STATUS_LETTER: Record<ReviewFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};
const STATUS_TONE: Record<ReviewFile["status"], string> = {
  added: "text-success",
  modified: "text-info",
  deleted: "text-destructive",
};
const STATUS_NAME: Record<ReviewFile["status"], string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
};

/** Files whose two sides are read at once. */
const READ_AT_ONCE = 4;

/** What sits under a line: a saved comment, the composer, or a GitHub conversation. */
type Note =
  | { kind: "comment"; comment: LineComment }
  | { kind: "composer" }
  | { kind: "note"; id: string };

/**
 * The order the tree shows files in: folders before files at each level, each
 * by name. The diffs follow it, so the tree and the column read the same way.
 */
function treeOrder<T extends { path: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    const x = a.path.split("/");
    const y = b.path.split("/");
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const xDir = i < x.length - 1;
      const yDir = i < y.length - 1;
      if (xDir !== yDir) return xDir ? -1 : 1;
      if (x[i] !== y[i]) return x[i]!.localeCompare(y[i]!);
    }
    return x.length - y.length;
  });
}

/** Commenting on lines, for GitHub and for the assistant. */
interface Commenting {
  commenting?: ThreadCommenting;
  github?: ThreadCommenting;
}

export function PullDiffs({
  review,
  refreshKey,
  diffStyle,
  collapse,
  commenting,
  github,
  conversations,
  yourChanges,
  drawer,
  onAskedAssistant,
}: {
  review: PullReviewView;
  refreshKey: unknown;
  diffStyle: DiffStyle;
  /** Fold or unfold every file: changes each time the header's button is pressed. */
  collapse: { all: boolean; at: number } | null;
  /** A PR review's conversations from GitHub, per file. */
  conversations?: (path: string) => FileConversations;
  /** Push to PR, Post as suggestions and Discard, over Your changes; `done` reads them again. */
  yourChanges?: (done: () => void) => ReactNode;
  /** Phones: the file tree slides over the diff. */
  drawer: { open: boolean; onOpenChange(open: boolean): void };
  /** A comment went to the assistant: the page shows it. */
  onAskedAssistant?: () => void;
} & Commenting) {
  const threadId = review.key;
  const settledKey = useSteadyKey(refreshKey);
  const reviewedSha = review.reviewedSha !== review.headSha ? review.reviewedSha : null;
  const [picked, setScope] = useState<Scope | null>(null);
  const scope: Scope = picked ?? (reviewedSha ? "review" : "base");
  const since = scope === "base" ? undefined : scope;
  // Viewed marks are per file content, so they hold in either whole-PR scope.
  const viewable = scope !== "mine";
  const [reload, setReload] = useState(0);
  const [files, setFiles] = useState<ReviewFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"files" | "comments">("files");
  const [hidden, setHidden] = useState<Set<ReviewFile["status"]>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const view = useRef<CodeViewHandle<Note, undefined>>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    projectsApi
      .reviewFiles(threadId, since)
      .then((list) => !cancelled && setFiles(treeOrder(list)))
      .catch(
        (e: unknown) => !cancelled && setError(errorMessage(e, "Could not read the changes.")),
      );
    return () => {
      cancelled = true;
    };
  }, [threadId, settledKey, reload, since]);

  const listed = useMemo(() => (files ?? []).filter((f) => !hidden.has(f.status)), [files, hidden]);

  // Folded files: generated and viewed ones start folded, until the owner unfolds them.
  const [folded, setFolded] = useState<Map<string, boolean>>(new Map());
  const isFolded = useCallback(
    (f: ReviewFile) => folded.get(f.path) ?? (f.isGenerated || (viewable && f.viewed)),
    [folded, viewable],
  );
  const fold = (path: string, value: boolean) => setFolded((m) => new Map(m).set(path, value));
  useEffect(() => {
    if (!collapse || !files) return;
    setFolded(new Map(files.map((f) => [f.path, collapse.all])));
  }, [collapse, files]);

  const diffs = useFileDiffs(threadId, since, listed, isFolded, reload);

  const toggleViewed = (file: ReviewFile) => {
    const viewed = !file.viewed;
    setFiles((list) => list?.map((f) => (f.path === file.path ? { ...f, viewed } : f)) ?? list);
    // Marked viewed, a file folds away; unmarked, it opens again.
    fold(file.path, viewed);
    projectsApi.setViewed(threadId, file.path, file.hash, viewed).catch((e: unknown) => {
      toast.error(errorMessage(e, "Could not save that."));
      setReload((n) => n + 1);
    });
  };

  const jump = useCallback(
    (path: string, line?: { side: "old" | "new"; line: number }) => {
      setFolded((m) => (m.get(path) === false ? m : new Map(m).set(path, false)));
      drawer.onOpenChange(false);
      // After the unfold lands.
      requestAnimationFrame(() =>
        view.current?.scrollTo(
          line
            ? {
                type: "line",
                id: path,
                lineNumber: line.line,
                side: SIDE[line.side],
                align: "center",
              }
            : { type: "item", id: path, align: "start" },
        ),
      );
    },
    [drawer],
  );

  // Line comments: one selection at a time, in one file.
  const [selection, setSelection] = useState<{
    path: string;
    lines: LineSelection;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState("");
  const current = useRef(selection);
  useEffect(() => {
    current.current = selection;
  }, [selection]);
  const rows = useRef(new Map<string, Row[] | null>());
  const rowsFor = useCallback(
    (path: string): Row[] | null => {
      const d = diffs.get(path);
      if (!d) return null;
      const key = `${path}\u0000${d.oldContent.length}:${d.newContent.length}`;
      if (!rows.current.has(key)) rows.current.set(key, rowsOf(d.oldContent, d.newContent));
      return rows.current.get(key) ?? null;
    },
    [diffs],
  );

  const takes = Boolean(commenting);
  const base = useBaseOptions();
  const options = useMemo<CodeViewReactOptions<Note, undefined>>(() => {
    const take = (range: SelectedLineRange | null, path: string) => {
      if (!range) return;
      const r = rowsFor(path);
      if (!r) return;
      const next = toSelection(range, r);
      const prev = current.current;
      // A new range (not a widened one) starts a new comment.
      const widened =
        prev &&
        prev.path === path &&
        prev.lines.side === next.side &&
        next.from <= prev.lines.from &&
        next.to >= prev.lines.to;
      if (!widened) setDraft("");
      current.current = { path, lines: next };
      setSelection({ path, lines: next });
    };
    type Context = { item: { id: string } };
    return {
      theme: base.theme,
      themeType: base.themeType,
      diffStyle,
      overflow: diffStyle === "split" ? "scroll" : "wrap",
      lineDiffType: "word",
      hunkSeparators: "line-info",
      stickyHeaders: true,
      lineHoverHighlight: "number",
      layout: { paddingTop: 0, gap: 1, paddingBottom: 0 },
      unsafeCSS: `${base.unsafeCSS}\n${DIFF_CSS}`,
      ...(takes
        ? {
            enableLineSelection: true,
            enableGutterUtility: true,
            onGutterUtilityClick: (range: SelectedLineRange, context: Context) =>
              take(range, context.item.id),
            onLineSelectionStart: () => setDragging(true),
            onLineSelectionChange: (range: SelectedLineRange | null, context: Context) =>
              take(range, context.item.id),
            onLineSelectionEnd: (range: SelectedLineRange | null, context: Context) => {
              take(range, context.item.id);
              setDragging(false);
            },
          }
        : {}),
    };
  }, [base, diffStyle, takes, rowsFor]);

  // Each file's comments, from the two lists that hold them.
  const perFile = useMemo(() => {
    const map = new Map<string, ReturnType<typeof fileCommenting>>();
    for (const f of listed) {
      const d = diffs.get(f.path);
      map.set(
        f.path,
        fileCommenting(
          commenting,
          {
            path: f.path,
            oldContent: d?.oldContent ?? "",
            newContent: d?.newContent ?? "",
          },
          github,
        ),
      );
    }
    return map;
  }, [listed, diffs, commenting, github]);

  const noteNodes = useMemo(() => {
    const map = new Map<string, ReactNode>();
    for (const f of listed)
      for (const n of conversations?.(f.path).notes ?? []) map.set(n.id, n.node);
    return map;
  }, [listed, conversations]);

  const versions = useRef(new Map<string, { sig: string; version: number }>());
  const parsed = useRef(new Map<string, FileDiffMetadata>());
  const items = useMemo(() => {
    return listed.map((f): CodeViewDiffItem<Note> => {
      const d = diffs.get(f.path);
      const folded = isFolded(f);
      const showable = d && !d.unshowable;
      const key = showable
        ? `${f.path}\u0000${f.hash}\u0000${since ?? ""}\u0000${d.oldContent.length}:${d.newContent.length}`
        : `${f.path}\u0000empty`;
      let fileDiff = parsed.current.get(key);
      if (!fileDiff) {
        fileDiff = parseDiffFromFile(
          { name: f.path, contents: showable ? d.oldContent : "" },
          { name: f.path, contents: showable ? d.newContent : "" },
        );
        parsed.current.set(key, fileDiff);
      }
      const annotations: DiffLineAnnotation<Note>[] = [];
      if (showable) {
        for (const n of conversations?.(f.path).notes ?? [])
          annotations.push({
            side: SIDE[n.side],
            lineNumber: n.line,
            metadata: { kind: "note", id: n.id },
          });
        for (const c of perFile.get(f.path)?.comments ?? [])
          annotations.push({
            side: SIDE[c.side],
            lineNumber: c.endLine,
            metadata: { kind: "comment", comment: c },
          });
        if (selection?.path === f.path && !dragging)
          annotations.push({
            side: SIDE[selection.lines.side],
            lineNumber: selection.lines.to,
            metadata: { kind: "composer" },
          });
      }
      const sig = `${key}|${folded}|${annotations
        .map((a) =>
          a.metadata.kind === "comment"
            ? `c${a.metadata.comment.id}`
            : a.metadata.kind === "note"
              ? `n${a.metadata.id}:${String(noteNodes.has(a.metadata.id))}`
              : `s${a.lineNumber}`,
        )
        .join(",")}`;
      const seen = versions.current.get(f.path);
      const version = !seen ? 0 : seen.sig === sig ? seen.version : seen.version + 1;
      versions.current.set(f.path, { sig, version });
      return {
        id: f.path,
        type: "diff",
        fileDiff,
        annotations,
        collapsed: folded || !showable,
        version,
      };
    });
  }, [listed, diffs, isFolded, since, conversations, perFile, selection, dragging, noteNodes]);

  const byPath = useMemo(() => new Map(listed.map((f) => [f.path, f])), [listed]);

  const totals = (files ?? []).reduce(
    (sum, f) => ({
      add: sum.add + f.additions,
      del: sum.del + f.deletions,
      viewed: sum.viewed + Number(f.viewed),
    }),
    { add: 0, del: 0, viewed: 0 },
  );
  const commentCount =
    (commenting?.comments.length ?? 0) +
    (github?.comments.length ?? 0) +
    listed.reduce((n, f) => n + (conversations?.(f.path).notes.length ?? 0), 0);

  const sidebar = (
    <Sidebar
      tab={tab}
      onTab={setTab}
      commentCount={commentCount}
      hidden={hidden}
      onHidden={setHidden}
      onClose={drawer.open ? () => drawer.onOpenChange(false) : undefined}
      scopePicker={
        <ScopePicker
          scope={scope}
          onScope={(s) => {
            setScope(s);
            setSelection(null);
          }}
          baseBranch={review.baseRef}
          reviewedSha={reviewedSha}
          withMine={Boolean(yourChanges)}
        />
      }
      actions={
        scope === "mine" && files && files.length > 0
          ? yourChanges?.(() => setReload((n) => n + 1))
          : null
      }
      footer={
        files && (
          <DiffStats
            files={files.length}
            viewed={viewable ? totals.viewed : null}
            additions={totals.add}
            deletions={totals.del}
            onRefresh={() => setReload((n) => n + 1)}
          />
        )
      }
    >
      {tab === "files" ? (
        files && listed.length > 0 ? (
          <Tree files={listed} viewable={viewable} onOpen={(path) => jump(path)} />
        ) : files ? (
          <p className="text-muted-foreground p-4 text-xs">No files match the filter.</p>
        ) : null
      ) : (
        <CommentList files={listed} perFile={perFile} conversations={conversations} onJump={jump} />
      )}
    </Sidebar>
  );

  return (
    <div className="relative flex min-h-0 flex-1" data-testid="code-review">
      <FileListPane className="hidden md:flex">{sidebar}</FileListPane>
      {drawer.open && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="bg-background border-border flex w-[85%] max-w-sm flex-col border-r shadow-lg">
            {sidebar}
          </div>
          <button
            type="button"
            aria-label="Close files"
            className="bg-background/60 flex-1"
            onClick={() => drawer.onOpenChange(false)}
          />
        </div>
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {error ? (
          <p className="text-destructive p-4 text-sm">{error}</p>
        ) : !files ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : files.length === 0 ? (
          scope === "mine" ? (
            <EmptyState
              icon={FileDiffIcon}
              title="You have not changed anything"
              description="Ask the assistant to change something, or open a terminal in this checkout."
            />
          ) : (
            <EmptyState
              icon={FileDiffIcon}
              title="No changes"
              description={`Nothing differs from ${review.baseRef} yet.`}
            />
          )
        ) : (
          <CodeView<Note, undefined>
            ref={view}
            items={items}
            options={options}
            className="min-h-0 flex-1 overflow-auto"
            selectedLines={
              selection
                ? {
                    id: selection.path,
                    range: {
                      start: selection.lines.from,
                      end: selection.lines.to,
                      side: SIDE[selection.lines.side],
                    },
                  }
                : null
            }
            renderHeaderPrefix={(item) => {
              const f = byPath.get(item.id);
              if (!f) return null;
              const shut = isFolded(f) || Boolean(diffs.get(f.path)?.unshowable);
              return (
                <button
                  type="button"
                  onClick={() => fold(f.path, !isFolded(f))}
                  aria-expanded={!shut}
                  aria-label={`${shut ? "Unfold" : "Fold"} ${f.path}`}
                  className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded"
                >
                  {shut ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
              );
            }}
            renderHeaderMetadata={(item) => {
              const f = byPath.get(item.id);
              if (!f) return null;
              const d = diffs.get(f.path);
              const loading = !d && !isFolded(f);
              const canEdit = scope !== "review" && d && !d.unshowable && f.status !== "deleted";
              return (
                <span className="flex items-center gap-2 font-sans text-xs">
                  {loading && <Spinner className="size-3" />}
                  {d?.unshowable && (
                    <span className="text-muted-foreground">{UNSHOWABLE_TEXT[d.unshowable]}</span>
                  )}
                  {f.isGenerated && <span className="text-muted-foreground">Generated</span>}
                  <span className={cn("tabular-nums", monoClass)}>
                    {f.deletions > 0 && <span className="text-destructive">-{f.deletions}</span>}
                    {f.deletions > 0 && f.additions > 0 && " "}
                    {f.additions > 0 && <span className="text-success">+{f.additions}</span>}
                  </span>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit ${f.path}`}
                      title="Edit this file (small changes)"
                      onClick={() => setEditing(f.path)}
                      className="text-muted-foreground"
                    >
                      <Pencil />
                    </Button>
                  )}
                  {viewable && (
                    <label className="text-muted-foreground flex items-center gap-1.5">
                      <Checkbox
                        checked={f.viewed}
                        onCheckedChange={() => toggleViewed(f)}
                        aria-label={`Viewed ${f.path}`}
                      />
                      <span className="hidden sm:inline">Viewed</span>
                    </label>
                  )}
                </span>
              );
            }}
            renderAnnotation={(annotation, _fileDiff, item) => {
              const { metadata } = annotation;
              const path = item.id;
              if (metadata.kind === "note") return noteNodes.get(metadata.id);
              const file = perFile.get(path);
              if (metadata.kind === "comment")
                return <SavedComment comment={metadata.comment} onRemove={file?.onRemoveComment} />;
              const sel = selection;
              const d = diffs.get(path);
              if (!sel || sel.path !== path || !file?.onComment || !d) return null;
              return (
                <Composer
                  path={path}
                  selection={sel.lines}
                  body={draft}
                  setBody={setDraft}
                  onCancel={() => setSelection(null)}
                  reviewing={file.reviewing}
                  selected={
                    sel.lines.side === "new"
                      ? d.newContent
                          .split("\n")
                          .slice(sel.lines.from - 1, sel.lines.to)
                          .join("\n")
                      : undefined
                  }
                  onSubmit={async (text: string, target: CommentTarget) => {
                    await file.onComment!(sel.lines, text, target);
                    setSelection(null);
                    setDraft("");
                    if (target === "agent") onAskedAssistant?.();
                  }}
                />
              );
            }}
          />
        )}
        {editing && diffs.get(editing) && (
          <div className="bg-background absolute inset-0 z-20 flex min-h-0 flex-col overflow-y-auto">
            <LightEditor
              key={editing}
              path={editing}
              content={diffs.get(editing)!.newContent}
              onCancel={() => setEditing(null)}
              onSave={async (text) => {
                await projectsApi.editFile(threadId, {
                  path: editing,
                  original: diffs.get(editing)!.newContent,
                  content: text,
                });
                setEditing(null);
                setReload((n) => n + 1);
                toast.success("Saved. It shows under Your changes.");
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Each unfolded file's two sides, read a few at a time in the column's order
 * and kept by content: a file whose hash changed is read again.
 */
function useFileDiffs(
  threadId: string,
  since: "review" | "mine" | undefined,
  files: ReviewFile[],
  isFolded: (f: ReviewFile) => boolean,
  reload: number,
): Map<string, ReviewFileDiff> {
  const [read, setRead] = useState<Map<string, ReviewFileDiff>>(new Map());
  const asked = useRef(new Set<string>());
  const scope = `${threadId}\u0000${since ?? ""}\u0000${reload}`;
  const keyOf = useCallback((f: ReviewFile) => `${scope}\u0000${f.path}\u0000${f.hash}`, [scope]);
  // A new scope or a reload starts over.
  useEffect(() => {
    asked.current = new Set();
    setRead(new Map());
  }, [scope]);

  const wanted = files.filter((f) => !isFolded(f) && !read.has(keyOf(f)));
  const wantedKey = wanted.map(keyOf).join("\n");
  useEffect(() => {
    let cancelled = false;
    const queue = wanted.filter((f) => !asked.current.has(keyOf(f)));
    const next = async () => {
      const f = queue.shift();
      if (!f || cancelled) return;
      const key = keyOf(f);
      asked.current.add(key);
      try {
        const d = await projectsApi.reviewFile(threadId, f.path, since);
        // Kept even after this run is replaced: the key names its scope, and
        // the next run skips what is already asked for.
        setRead((m) => new Map(m).set(key, d));
      } catch {
        // Not read: unfolding it again asks once more.
        asked.current.delete(key);
      }
      await next();
    };
    for (let i = 0; i < READ_AT_ONCE; i++) void next();
    return () => {
      cancelled = true;
      for (const f of queue) asked.current.delete(keyOf(f));
    };
    // `wanted` is keyed by `wantedKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, threadId, since, keyOf]);

  return useMemo(() => {
    const byPath = new Map<string, ReviewFileDiff>();
    for (const f of files) {
      const d = read.get(keyOf(f));
      if (d) byPath.set(f.path, d);
    }
    return byPath;
  }, [files, read, keyOf]);
}

function Sidebar({
  tab,
  onTab,
  commentCount,
  hidden,
  onHidden,
  onClose,
  scopePicker,
  actions,
  footer,
  children,
}: {
  tab: "files" | "comments";
  onTab(tab: "files" | "comments"): void;
  commentCount: number;
  hidden: Set<ReviewFile["status"]>;
  onHidden(hidden: Set<ReviewFile["status"]>): void;
  onClose?: () => void;
  scopePicker: ReactNode;
  actions: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const tabButton = (value: "files" | "comments", label: string, icon: ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      aria-label={label}
      title={label}
      onClick={() => onTab(value)}
      className={cn(
        "hover:text-foreground flex h-7 items-center gap-1 rounded-md px-1.5 text-xs",
        tab === value ? "text-foreground bg-muted" : "text-muted-foreground",
      )}
    >
      {icon}
      {value === "comments" && commentCount > 0 && (
        <span className="tabular-nums">{commentCount}</span>
      )}
    </button>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <div role="tablist" aria-label="Sidebar" className="flex items-center gap-0.5">
          {tabButton("files", "Files", <Files className="size-4" />)}
          {tabButton("comments", "Comments", <MessagesSquare className="size-4" />)}
        </div>
        <span className="flex-1" />
        {tab === "files" && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Search files"
              title="Search files"
              className="text-muted-foreground"
              onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH))}
            >
              <Search />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Filter by status"
                  title="Filter by status"
                  className={cn(hidden.size > 0 ? "text-foreground" : "text-muted-foreground")}
                >
                  <ListFilter />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Show files</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(["added", "modified", "deleted"] as const).map((status) => (
                  <DropdownMenuCheckboxItem
                    key={status}
                    checked={!hidden.has(status)}
                    onCheckedChange={(on) => {
                      const next = new Set(hidden);
                      if (on) next.delete(status);
                      else next.add(status);
                      onHidden(next);
                    }}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className={cn("w-3 font-medium", STATUS_TONE[status])}>
                      {STATUS_LETTER[status]}
                    </span>
                    {STATUS_NAME[status]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close files"
            className="text-muted-foreground"
            onClick={onClose}
          >
            <X />
          </Button>
        )}
      </div>
      <div className="px-2 pb-1">{scopePicker}</div>
      {actions && <div className="flex flex-wrap items-center gap-1 px-2 pb-2">{actions}</div>}
      <div
        className="flex min-h-0 flex-1 flex-col"
        role="tabpanel"
        aria-label={tab === "files" ? "Changed files" : "Comments"}
      >
        {children}
      </div>
      {footer}
    </div>
  );
}

/** The sidebar's Search button asks the tree to open its search line. */
const OPEN_SEARCH = "tiny-agents:review-tree-search";

/** The changed files as a tree: status letters, and a check on viewed ones. */
function Tree({
  files,
  viewable,
  onOpen,
}: {
  files: ReviewFile[];
  viewable: boolean;
  onOpen(path: string): void;
}) {
  const open = useRef(onOpen);
  useEffect(() => {
    open.current = onOpen;
  }, [onOpen]);
  const viewed = useRef(new Set<string>());
  const paths = useMemo(() => files.map((f) => f.path), [files]);
  const status = useMemo<GitStatusEntry[]>(
    () => files.map((f) => ({ path: f.path, status: f.status })),
    [files],
  );
  const { model } = useFileTree({
    paths,
    gitStatus: status,
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    // The column's order (folders first), kept as given.
    presorted: true,
    sort: () => 0,
    stickyFolders: true,
    search: true,
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    unsafeCSS: TREE_CSS,
    onSelectionChange: (selected) => {
      const path = selected[0];
      if (path && !path.endsWith("/")) open.current(path);
    },
    renderRowDecoration: ({ item }) =>
      item.kind === "file" && viewed.current.has(item.path) ? { text: "✓", title: "Viewed" } : null,
  });
  // Keep the model's paths and marks in step with the list.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    model.resetPaths(paths);
  }, [model, paths]);
  useEffect(() => {
    viewed.current = new Set(viewable ? files.filter((f) => f.viewed).map((f) => f.path) : []);
    model.setGitStatus(status);
  }, [model, files, status, viewable]);
  useEffect(() => {
    const onSearch = () => model.openSearch();
    window.addEventListener(OPEN_SEARCH, onSearch);
    return () => window.removeEventListener(OPEN_SEARCH, onSearch);
  }, [model]);
  return (
    <FileTree
      model={model}
      aria-label="Changed files"
      className="min-h-0 flex-1"
      style={TREE_STYLE}
    />
  );
}

/**
 * Adapted from diffshub (github.com/pierrecomputer/pierre, apps/diffshub,
 * Apache-2.0; see CREDITS.md): the search line shows only once opened, every
 * folder holds a change so its dot is hidden, and folders read a little
 * stronger than files.
 */
const TREE_CSS = `
  [data-file-tree-search-container][data-open='false'] { display: none; }
  [data-file-tree-search-container] { padding-bottom: 8px; margin-bottom: 4px; }
  [data-item-contains-git-change='true'] > [data-item-section='git'] { display: none; }
  [data-item-type='folder'] { color: var(--trees-fg); font-weight: 500; }
`;

/** Diff headers stay at the top while their file scrolls under them. */
const DIFF_CSS = `
  :host { --diffs-bg: var(--background); }
  [data-deletions-count], [data-additions-count] { display: none; }
  [data-diffs-header] { container-type: scroll-state; container-name: sticky-header; }
  @container sticky-header scroll-state(stuck: top) {
    [data-diffs-header]::after {
      position: absolute; bottom: -1px; left: 0; width: 100%; height: 1px;
      content: ''; background-color: var(--border);
    }
  }
`;

/** The tree in the app's colors and type. */
const TREE_STYLE = {
  "--trees-bg": "transparent",
  "--trees-fg": "var(--foreground)",
  "--trees-fg-muted": "var(--muted-foreground)",
  "--trees-bg-muted": "var(--muted)",
  "--trees-selected-bg": "var(--accent)",
  "--trees-selected-fg": "var(--accent-foreground)",
  "--trees-accent": "var(--ring)",
  "--trees-focus-ring-color": "var(--ring)",
  "--trees-search-bg": "var(--muted)",
  "--trees-search-fg": "var(--foreground)",
  "--trees-font-size": "13px",
  "--trees-font-family": "inherit",
} as React.CSSProperties;

/** Which changes the column shows: since your review, the whole PR, or your changes. */
function ScopePicker({
  scope,
  onScope,
  baseBranch,
  reviewedSha,
  withMine,
}: {
  scope: Scope;
  onScope(scope: Scope): void;
  baseBranch: string;
  reviewedSha: string | null;
  withMine: boolean;
}) {
  const label =
    scope === "review"
      ? "Since your review"
      : scope === "mine"
        ? "Your changes"
        : `Since ${baseBranch}`;
  if (!reviewedSha && !withMine) {
    return (
      <span className="text-muted-foreground flex h-8 items-center gap-1.5 px-2 text-xs">
        <FileDiffIcon className="size-3.5" />
        {label}
      </span>
    );
  }
  return (
    <SearchSelect
      label="Changes to show"
      value={scope}
      onValueChange={(v) => onScope(v as Scope)}
      searchable={false}
      options={[
        ...(reviewedSha
          ? [
              {
                value: "review",
                label: "Since your review",
                description: `What changed after ${reviewedSha.slice(0, 7)}`,
              },
            ]
          : []),
        {
          value: "base",
          label: `Since ${baseBranch}`,
          description: "The whole pull request",
        },
        ...(withMine
          ? [
              {
                value: "mine",
                label: "Your changes",
                description: "Changed in this checkout, not on GitHub yet",
              },
            ]
          : []),
      ]}
      triggerClassName="text-foreground h-8 w-full justify-start text-xs"
    >
      <FileDiffIcon className="text-muted-foreground size-3.5" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <ChevronDown className="opacity-50" />
    </SearchSelect>
  );
}

function DiffStats({
  files,
  viewed,
  additions,
  deletions,
  onRefresh,
}: {
  files: number;
  viewed: number | null;
  additions: number;
  deletions: number;
  onRefresh(): void;
}) {
  const row = (label: string, value: ReactNode) => (
    <div className="border-border flex items-center justify-between border-t py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
  return (
    <section
      aria-label="Diff stats"
      className="border-border shrink-0 border-t px-3 pt-2 pb-3 text-xs"
    >
      <div className="flex items-center justify-between pb-1">
        <h2 className="text-muted-foreground font-medium">Diff stats</h2>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRefresh}
          aria-label="Refresh changes"
          title="Refresh changes"
          className="text-muted-foreground"
        >
          <RefreshCw />
        </Button>
      </div>
      <dl>
        {row("Files", files)}
        {viewed !== null && row("Viewed", `${viewed} of ${files}`)}
        {row("Additions", <span className="text-success">{additions.toLocaleString()}</span>)}
        {row("Deletions", <span className="text-destructive">{deletions.toLocaleString()}</span>)}
      </dl>
    </section>
  );
}

/** The Comments tab: what waits to be sent, and GitHub's conversations, by file. */
function CommentList({
  files,
  perFile,
  conversations,
  onJump,
}: {
  files: ReviewFile[];
  perFile: Map<string, ReturnType<typeof fileCommenting>>;
  conversations?: (path: string) => FileConversations;
  onJump(path: string, line?: { side: "old" | "new"; line: number }): void;
}) {
  const groups = files
    .map((f) => ({
      file: f,
      comments: perFile.get(f.path)?.comments ?? [],
      remove: perFile.get(f.path)?.onRemoveComment,
      threads: conversations?.(f.path),
    }))
    .filter((g) => g.comments.length > 0 || (g.threads?.notes.length ?? 0) > 0 || g.threads?.aside);
  if (groups.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs">
        <MessagesSquare className="size-5" aria-hidden />
        <p className="text-foreground font-medium">No comments yet</p>
        <p>Select line numbers, or the + beside a line, to comment.</p>
      </div>
    );
  }
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" aria-label="Comments by file">
      {groups.map(({ file, comments, remove, threads }) => (
        <li key={file.path} className="py-1">
          <button
            type="button"
            onClick={() => onJump(file.path)}
            className={cn(
              "text-muted-foreground hover:text-foreground w-full truncate px-2 py-1 text-left text-xs font-medium",
            )}
            title={file.path}
          >
            {file.path}
          </button>
          <ul>
            {comments.map((c) => (
              <li key={c.id} className="group flex items-start gap-1">
                <button
                  type="button"
                  onClick={() => onJump(file.path, { side: c.side, line: c.endLine })}
                  className="hover:bg-muted flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs"
                >
                  <span className="text-muted-foreground tabular-nums">
                    {c.side === "old" ? "Removed line" : "Line"}{" "}
                    {c.startLine === c.endLine ? c.startLine : `${c.startLine}–${c.endLine}`}
                    {" · "}
                    {("tag" in c && typeof c.tag === "string" ? c.tag : null) ?? "Not sent"}
                  </span>
                  <span className="line-clamp-2">{c.body}</span>
                </button>
                {remove && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove comment"
                    className="text-muted-foreground mt-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => remove(c.id)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
            {threads?.notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onJump(file.path, { side: n.side, line: n.line })}
                  className="hover:bg-muted flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs"
                >
                  <MessagesSquare className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">
                    Conversation on {n.side === "old" ? "removed line" : "line"} {n.line}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {threads?.aside}
        </li>
      ))}
    </ul>
  );
}
