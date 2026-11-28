import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  Files,
  FoldVertical,
  ListFilter,
  ListTree,
  MessagesSquare,
  Pencil,
  RefreshCw,
  Rows2,
  Search,
  Trash2,
  UnfoldVertical,
  X,
} from "lucide-react";
import { Button, Checkbox, monoClass } from "@groot/ui";
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
  type CodeViewDiffItem,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type SelectedLineRange,
} from "@pierre/diffs";
import { CodeView, type CodeViewHandle, type CodeViewReactOptions } from "@pierre/diffs/react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { GitStatusEntry } from "@pierre/trees";
import { Spinner } from "../../components/ui/spinner";
import { fileCommenting, type ThreadCommenting } from "../../lib/code/comments";
import type { ReviewFileDiff } from "../../../shared/api/code";
import type { FileConversations } from "./PullThreads";
import { FileListPane } from "./ResizablePane";
import { LightEditor } from "./LightEditor";
import { TREE_STYLE } from "./tree-style";
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
import { readStored, writeStored } from "../../lib/browser-storage";

export type DiffStyle = "split" | "unified";

export interface WorkspaceFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  isGenerated: boolean;
  hash: string;
  viewed?: boolean;
}

type FileStatus = WorkspaceFile["status"];

const FILE_STATUS: Record<FileStatus, { letter: string; label: string; tone: string }> = {
  added: { letter: "A", label: "Added", tone: "text-success" },
  modified: { letter: "M", label: "Modified", tone: "text-info" },
  deleted: { letter: "D", label: "Deleted", tone: "text-destructive" },
};

const READ_AT_ONCE = 4;

const STYLE_KEY = "code:diff-style";
const WIDE = "(min-width: 1024px)";

function readStyle(): DiffStyle {
  return readStored(STYLE_KEY) === "unified" ? "unified" : "split";
}

function useDiffStyle(): [DiffStyle, (style: DiffStyle) => void] {
  const [style, setStyle] = useState<DiffStyle>(readStyle);
  const change = useCallback((next: DiffStyle) => {
    setStyle(next);
    writeStored(STYLE_KEY, next);
  }, []);
  return [style, change];
}

function useWide(): boolean {
  return useSyncExternalStore(
    (change) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(WIDE).matches,
  );
}

export type CollapseAll = { all: boolean; at: number } | null;

export function useDiffView() {
  const [style, setStyle] = useDiffStyle();
  const wide = useWide();
  const [collapse, setCollapse] = useState<CollapseAll>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const drawer = useMemo(() => ({ open: filesOpen, onOpenChange: setFilesOpen }), [filesOpen]);
  return { style, setStyle, wide, collapse, setCollapse, drawer };
}

export type DiffView = ReturnType<typeof useDiffView>;

export function FilesButton({ view }: { view: DiffView }) {
  const { open, onOpenChange } = view.drawer;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground shrink-0 md:hidden"
      aria-label="Files"
      aria-expanded={open}
      onClick={() => onOpenChange(!open)}
    >
      <ListTree />
    </Button>
  );
}

export function DiffViewButtons({ view }: { view: DiffView }) {
  const { style, setStyle: onStyle, collapse, setCollapse: onCollapse } = view;
  const allFolded = collapse?.all ?? false;
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={style === "split" ? "Switch to unified view" : "Switch to split view"}
        title={style === "split" ? "Unified view" : "Split view"}
        onClick={() => onStyle(style === "split" ? "unified" : "split")}
      >
        {style === "split" ? <Rows2 /> : <Columns2 />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={allFolded ? "Unfold all files" : "Fold all files"}
        title={allFolded ? "Unfold all files" : "Fold all files"}
        onClick={() => onCollapse({ all: !allFolded, at: Date.now() })}
      >
        {allFolded ? <UnfoldVertical /> : <FoldVertical />}
      </Button>
    </>
  );
}

type Note =
  | { kind: "comment"; comment: LineComment }
  | { kind: "composer" }
  | { kind: "note"; id: string };

export function treeOrder<T extends { path: string }>(files: T[]): T[] {
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

export function DiffWorkspace<F extends WorkspaceFile>({
  files,
  error,
  scopeKey,
  readKey = "",
  read,
  layout,
  diffStyle,
  collapse = null,
  onViewed,
  canEdit,
  onSave,
  commenting,
  github,
  conversations,
  onAskedAssistant,
  scope,
  actions,
  empty,
  onRefresh,
  drawer: outerDrawer,
  testId = "code-review",
}: {
  files: F[] | null;
  error?: string | null;
  scopeKey: string;
  readKey?: string;
  read(path: string): Promise<ReviewFileDiff>;
  layout: "page" | "panel";
  diffStyle: DiffStyle;
  collapse?: CollapseAll;
  onViewed?: (file: F, viewed: boolean) => void;
  canEdit?: (file: F) => boolean;
  onSave?: (path: string, original: string, content: string) => Promise<void>;
  commenting?: ThreadCommenting;
  github?: ThreadCommenting;
  conversations?: (path: string) => FileConversations;
  onAskedAssistant?: () => void;
  scope?: ReactNode;
  actions?: ReactNode;
  empty: ReactNode;
  onRefresh(): void;
  drawer?: { open: boolean; onOpenChange(open: boolean): void };
  testId?: string;
}) {
  const [ownDrawer, setOwnDrawer] = useState(false);
  const drawer = useMemo(
    () => outerDrawer ?? { open: ownDrawer, onOpenChange: setOwnDrawer },
    [outerDrawer, ownDrawer],
  );
  const viewable = Boolean(onViewed);
  const [tab, setTab] = useState<"files" | "comments">("files");
  const [hidden, setHidden] = useState<Set<FileStatus>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const view = useRef<CodeViewHandle<Note, undefined>>(null);

  const listed = useMemo(() => (files ?? []).filter((f) => !hidden.has(f.status)), [files, hidden]);

  const [folded, setFolded] = useState<Map<string, boolean>>(new Map());
  const isFolded = useCallback(
    (f: F) => folded.get(f.path) ?? (f.isGenerated || (viewable && Boolean(f.viewed))),
    [folded, viewable],
  );
  const fold = (path: string, value: boolean) => setFolded((m) => new Map(m).set(path, value));
  useEffect(() => {
    if (!collapse || !files) return;
    setFolded(new Map(files.map((f) => [f.path, collapse.all])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapse]);

  const diffs = useFileDiffs(scopeKey, readKey, listed, isFolded, read);

  const toggleViewed = (file: F) => {
    const viewed = !file.viewed;
    fold(file.path, viewed);
    onViewed?.(file, viewed);
  };

  const jump = useCallback(
    (path: string, line?: { side: "old" | "new"; line: number }) => {
      setFolded((m) => (m.get(path) === false ? m : new Map(m).set(path, false)));
      drawer.onOpenChange(false);
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
  useEffect(() => setSelection(null), [scopeKey]);
  const rows = useRef(new WeakMap<ReviewFileDiff, Row[] | null>());
  const rowsFor = useCallback(
    (path: string): Row[] | null => {
      const d = diffs.get(path);
      if (!d) return null;
      if (!rows.current.has(d)) rows.current.set(d, rowsOf(d.oldContent, d.newContent));
      return rows.current.get(d) ?? null;
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
  const parsed = useRef(new WeakMap<ReviewFileDiff, FileDiffMetadata>());
  const items = useMemo(() => {
    return listed.map((f): CodeViewDiffItem<Note> => {
      const d = diffs.get(f.path);
      const folded = isFolded(f);
      const showable = d && !d.unshowable;
      let fileDiff = showable ? parsed.current.get(d) : undefined;
      if (!fileDiff) {
        fileDiff = parseDiffFromFile(
          { name: f.path, contents: showable ? d.oldContent : "" },
          { name: f.path, contents: showable ? d.newContent : "" },
        );
        if (showable) parsed.current.set(d, fileDiff);
      }
      const key = showable ? `${ids.get(d)}` : "empty";
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
  }, [listed, diffs, isFolded, conversations, perFile, selection, dragging, noteNodes]);

  const byPath = useMemo(() => new Map(listed.map((f) => [f.path, f])), [listed]);

  const totals = (files ?? []).reduce(
    (sum, f) => ({
      add: sum.add + f.additions,
      del: sum.del + f.deletions,
      viewed: sum.viewed + Number(Boolean(f.viewed)),
    }),
    { add: 0, del: 0, viewed: 0 },
  );
  const commentCount =
    (commenting?.comments.length ?? 0) +
    (github?.comments.length ?? 0) +
    listed.reduce((n, f) => n + (conversations?.(f.path).notes.length ?? 0), 0);

  const panel = layout === "panel";
  const sidebar = (
    <Sidebar
      tab={tab}
      onTab={setTab}
      commentCount={commentCount}
      hidden={hidden}
      onHidden={setHidden}
      onClose={drawer.open ? () => drawer.onOpenChange(false) : undefined}
      scopePicker={panel ? null : scope}
      actions={panel ? null : actions}
      footer={
        files && (
          <DiffStats
            files={files.length}
            viewed={viewable ? totals.viewed : null}
            additions={totals.add}
            deletions={totals.del}
            onRefresh={onRefresh}
          />
        )
      }
    >
      {tab === "files" ? (
        files && listed.length > 0 ? (
          <Tree files={listed} viewable={viewable} onOpen={(path) => jump(path)} />
        ) : files && files.length > 0 ? (
          <p className="text-muted-foreground p-4 text-xs">No files match the filter.</p>
        ) : null
      ) : (
        <CommentList files={listed} perFile={perFile} conversations={conversations} onJump={jump} />
      )}
    </Sidebar>
  );

  const column = (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {error && files && (
        <p className="text-destructive shrink-0 px-3 py-1.5 text-xs">
          {error} Showing the last read.
        </p>
      )}
      {error && !files ? (
        <p className="text-destructive p-4 text-sm">{error}</p>
      ) : !files ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : files.length === 0 ? (
        empty
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
                data-testid="code-file"
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
            const editable = onSave && canEdit?.(f) && d && !d.unshowable && f.status !== "deleted";
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
                {editable && (
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
                      checked={Boolean(f.viewed)}
                      onCheckedChange={() => toggleViewed(f)}
                      aria-label={`Viewed ${f.path}`}
                    />
                    <span className={panel ? "hidden" : "hidden sm:inline"}>Viewed</span>
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
      {editing && onSave && diffs.get(editing) && (
        <div className="bg-background absolute inset-0 z-20 flex min-h-0 flex-col overflow-y-auto">
          <LightEditor
            key={editing}
            path={editing}
            content={diffs.get(editing)!.newContent}
            onCancel={() => setEditing(null)}
            onSave={async (text) => {
              await onSave(editing, diffs.get(editing)!.newContent, text);
              setEditing(null);
            }}
          />
        </div>
      )}
    </div>
  );

  if (panel) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col" data-testid={testId}>
        <div className="border-border flex h-11 shrink-0 items-center gap-1 border-b px-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground shrink-0"
            aria-label="Files"
            title="Files"
            aria-expanded={drawer.open}
            disabled={!files || files.length === 0}
            onClick={() => drawer.onOpenChange(!drawer.open)}
          >
            <ListTree />
          </Button>
          <div className="min-w-0 shrink">{scope}</div>
          {actions}
          <span className="flex-1" />
          {files && files.length > 0 && (
            <span className="text-muted-foreground shrink-0 px-1 text-xs tabular-nums">
              {viewable
                ? `${totals.viewed}/${files.length} viewed `
                : `${files.length === 1 ? "1 file" : `${files.length} files`} `}
              <span className="text-success">+{totals.add}</span>{" "}
              <span className="text-destructive">−{totals.del}</span>
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            aria-label="Refresh changes"
            title="Refresh changes"
            className="text-muted-foreground shrink-0"
          >
            <RefreshCw />
          </Button>
        </div>
        <div className="relative flex min-h-0 flex-1">
          {column}
          {drawer.open && (
            <div className="absolute inset-0 z-30 flex">
              <nav
                aria-label="Changed files"
                className="bg-background border-border flex w-[85%] max-w-sm flex-col border-r shadow-lg"
              >
                {sidebar}
              </nav>
              <button
                type="button"
                aria-label="Close files"
                className="bg-background/60 flex-1"
                onClick={() => drawer.onOpenChange(false)}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1" data-testid={testId}>
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
      {column}
    </div>
  );
}

let nextId = 0;
const ids = {
  map: new WeakMap<ReviewFileDiff, number>(),
  get(d: ReviewFileDiff): number {
    let id = this.map.get(d);
    if (id === undefined) {
      id = ++nextId;
      this.map.set(d, id);
    }
    return id;
  },
};

function useFileDiffs<F extends WorkspaceFile>(
  scopeKey: string,
  readKey: string,
  files: F[],
  isFolded: (f: F) => boolean,
  read: (path: string) => Promise<ReviewFileDiff>,
): Map<string, ReviewFileDiff> {
  const [state, setState] = useState<{
    scope: string;
    byKey: Map<string, ReviewFileDiff>;
    latest: Map<string, ReviewFileDiff>;
  }>({ scope: scopeKey, byKey: new Map(), latest: new Map() });
  const asked = useRef(new Set<string>());
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  }, [read]);
  const scope = useRef(scopeKey);
  useEffect(() => {
    scope.current = scopeKey;
    asked.current = new Set();
    setState({ scope: scopeKey, byKey: new Map(), latest: new Map() });
  }, [scopeKey]);
  const current = state.scope === scopeKey ? state : null;

  const keyOf = useCallback(
    (f: F) => `${scopeKey}\u0000${readKey}\u0000${f.path}\u0000${f.hash}`,
    [scopeKey, readKey],
  );
  const wanted = files.filter((f) => !isFolded(f) && !current?.byKey.has(keyOf(f)));
  const wantedKey = wanted.map(keyOf).join("\n");
  useEffect(() => {
    let cancelled = false;
    const queue = wanted.filter((f) => !asked.current.has(keyOf(f)));
    const at = scopeKey;
    const next = async () => {
      const f = queue.shift();
      if (!f || cancelled) return;
      const key = keyOf(f);
      asked.current.add(key);
      try {
        const d = await reader.current(f.path);
        setState((s) =>
          s.scope !== at || scope.current !== at
            ? s
            : {
                scope: s.scope,
                byKey: new Map(s.byKey).set(key, d),
                latest: new Map(s.latest).set(f.path, d),
              },
        );
      } catch {
        asked.current.delete(key);
      }
      await next();
    };
    for (let i = 0; i < READ_AT_ONCE; i++) void next();
    return () => {
      cancelled = true;
      for (const f of queue) asked.current.delete(keyOf(f));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, scopeKey, keyOf]);

  return useMemo(() => {
    const byPath = new Map<string, ReviewFileDiff>();
    if (!current) return byPath;
    for (const f of files) {
      const d = current.byKey.get(keyOf(f)) ?? current.latest.get(f.path);
      if (d) byPath.set(f.path, d);
    }
    return byPath;
  }, [files, current, keyOf]);
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
  hidden: Set<FileStatus>;
  onHidden(hidden: Set<FileStatus>): void;
  onClose?: () => void;
  scopePicker?: ReactNode;
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
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Filter by status"
                    title="Filter by status"
                    className={cn(hidden.size > 0 ? "text-foreground" : "text-muted-foreground")}
                  />
                }
              >
                <ListFilter />
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
                    <span className={cn("w-3 font-medium", FILE_STATUS[status].tone)}>
                      {FILE_STATUS[status].letter}
                    </span>
                    {FILE_STATUS[status].label}
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
      {scopePicker && <div className="px-2 pb-1">{scopePicker}</div>}
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

const OPEN_SEARCH = "tiny-agents:review-tree-search";

function Tree({
  files,
  viewable,
  onOpen,
}: {
  files: WorkspaceFile[];
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

function CommentList({
  files,
  perFile,
  conversations,
  onJump,
}: {
  files: WorkspaceFile[];
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
