import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Search, X } from "lucide-react";
import { toast } from "sonner";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { GitStatusEntry } from "@pierre/trees";
import { monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { projectsApi } from "../../lib/code/projects";
import { useResource } from "../../queries/resource";
import { Kbd } from "../../components/keys";
import type { FileHit, ReviewFile } from "../../../shared/api/code";
import { LightEditor } from "./LightEditor";
import { TREE_STYLE } from "./tree-style";

const TREE_CSS = `
  [data-file-tree-search-container] { padding-bottom: 6px; margin-bottom: 2px; }
  [data-item-type='folder'] { color: var(--trees-fg); font-weight: 500; }
`;

const STATUS_WORD: Record<ReviewFile["status"], string> = {
  added: "New",
  modified: "Changed",
  deleted: "Deleted",
};

function foldersOf(paths: readonly string[]): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      folders.add(`${parts.slice(0, depth).join("/")}/`);
    }
  }
  return [...folders];
}

function sayTheClipboardRefused() {
  toast.error("Could not copy the path.");
}

function copyPath(path: string) {
  void navigator.clipboard
    .writeText(path)
    .then(() => toast.success(`Copied ${path}`))
    .catch(sayTheClipboardRefused);
}

const noFocusToClear = () => undefined;

export interface FilesFocus {
  which: "name" | "text";
  at: number;
}

function WorktreeTree({
  paths,
  changed,
  open,
  onOpen,
  focus,
  onFocused,
}: {
  paths: string[];
  changed: ReviewFile[];
  open: string | null;
  onOpen(path: string): void;
  focus: FilesFocus | null;
  onFocused(): void;
}) {
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  const present = useMemo(() => new Set(paths), [paths]);
  const status = useMemo<GitStatusEntry[]>(
    () =>
      changed
        .filter((file) => present.has(file.path))
        .map((file) => ({ path: file.path, status: file.status })),
    [changed, present],
  );
  const { model } = useFileTree({
    paths,
    gitStatus: status,
    initialExpansion: "closed",
    initialExpandedPaths: foldersOf(status.map((entry) => entry.path)),
    flattenEmptyDirectories: true,
    stickyFolders: true,
    search: true,
    density: "compact",
    icons: { set: "standard", colored: true },
    labels: { searchPlaceholder: "Open a file by name" },
    fileTreeSearchMode: "hide-non-matches",
    unsafeCSS: TREE_CSS,
    onSelectionChange: (selected) => {
      const path = selected[0];
      if (path && !path.endsWith("/")) onOpenRef.current(path);
    },
  });
  const shown = useRef(paths.join("\n"));
  useEffect(() => {
    const next = paths.join("\n");
    if (next === shown.current) return;
    shown.current = next;
    model.resetPaths(paths, { initialExpandedPaths: foldersOf(status.map((s) => s.path)) });
  }, [model, paths, status]);
  useEffect(() => {
    model.setGitStatus(status);
  }, [model, status]);
  useEffect(() => {
    if (!open) {
      for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
      return;
    }
    if (model.getSelectedPaths()[0] === open) return;
    for (const folder of foldersOf([open])) {
      const item = model.getItem(folder);
      if (item && "expand" in item) item.expand();
    }
    model.getItem(open)?.select();
    model.scrollToPath(open, { offset: "nearest" });
  }, [model, open]);
  useEffect(() => {
    if (focus?.which !== "name") return;
    model.openSearch();
    requestAnimationFrame(() =>
      model
        .getFileTreeContainer()
        ?.shadowRoot?.querySelector<HTMLInputElement>("[data-file-tree-search-container] input")
        ?.focus(),
    );
    onFocused();
  }, [model, focus, onFocused]);
  return (
    <FileTree
      model={model}
      aria-label="Files in the worktree"
      className="min-h-0 flex-1"
      style={TREE_STYLE}
    />
  );
}

function Hits({
  hits,
  query,
  open,
  onOpen,
}: {
  hits: FileHit[];
  query: string;
  open: string | null;
  onOpen(path: string): void;
}) {
  const byFile = useMemo(() => {
    const grouped = new Map<string, FileHit[]>();
    for (const hit of hits) grouped.set(hit.path, [...(grouped.get(hit.path) ?? []), hit]);
    return [...grouped];
  }, [hits]);
  if (byFile.length === 0) {
    return <p className="text-muted-foreground px-3 py-2 text-xs">Nothing contains “{query}”.</p>;
  }
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto pb-2" data-testid="code-files-list">
      {byFile.map(([path, lines]) => (
        <li key={path} className="pt-1">
          <button
            type="button"
            onClick={() => onOpen(path)}
            aria-current={path === open ? "true" : undefined}
            className={cn(
              "hover:bg-muted flex w-full items-center gap-2 px-3 py-0.5 text-left text-xs font-medium outline-none focus-visible:bg-muted",
              path === open && "bg-muted",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{path}</span>
            <span className="text-muted-foreground shrink-0 tabular-nums">{lines.length}</span>
          </button>
          <ul>
            {lines.map((hit) => (
              <li key={hit.line}>
                <button
                  type="button"
                  onClick={() => onOpen(path)}
                  className={cn(
                    "hover:bg-muted text-muted-foreground flex w-full items-baseline gap-2 py-0.5 pr-3 pl-5 text-left text-xs outline-none focus-visible:bg-muted",
                    monoClass,
                  )}
                >
                  <span className="w-8 shrink-0 text-right tabular-nums">{hit.line}</span>
                  <span className="text-foreground min-w-0 truncate">{hit.text.trim()}</span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function PathTitle({ path, status }: { path: string; status?: ReviewFile["status"] }) {
  const parts = path.split("/");
  const name = parts.pop();
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className={cn("min-w-0 truncate", monoClass)} data-testid="code-file-path" title={path}>
        {parts.length > 0 && <span className="text-muted-foreground">{parts.join("/")}/</span>}
        <span className="text-foreground font-medium">{name}</span>
      </span>
      {status && (
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-px text-[11px]",
            status === "added" ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
          )}
        >
          {STATUS_WORD[status]}
        </span>
      )}
      <button
        type="button"
        onClick={() => copyPath(path)}
        aria-label={`Copy ${path}`}
        title="Copy the path"
        className="text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Copy className="size-3" />
      </button>
    </span>
  );
}

export function FilesPane({
  threadId,
  refreshKey,
  focus = null,
  onFocused = noFocusToClear,
}: {
  threadId: string;
  refreshKey: unknown;
  focus?: FilesFocus | null;
  onFocused?(): void;
}) {
  const [text, setText] = useState("");
  const [searched, setSearched] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const textInput = useRef<HTMLInputElement>(null);

  const files = useResource(
    ["code", "files", threadId, refreshKey],
    () => projectsApi.files(threadId),
    "Could not list the files.",
  );
  const changed = useResource(
    ["code", "files", threadId, "changed", refreshKey],
    () => projectsApi.reviewFiles(threadId),
    "Could not read what changed.",
  );
  const hits = useResource(
    ["code", "files", threadId, "search", searched],
    () => projectsApi.searchFiles(threadId, searched),
    "Could not search.",
    { enabled: searched.length >= 2 },
  );
  const file = useResource(
    ["code", "files", threadId, "content", open],
    () => projectsApi.fileContent(threadId, open!),
    "Could not open the file.",
    { enabled: open !== null },
  );

  useEffect(() => {
    if (focus?.which !== "text") return;
    textInput.current?.focus();
    onFocused();
  }, [focus, onFocused]);

  const changedFiles = changed.data ?? [];
  const openStatus = changedFiles.find((entry) => entry.path === open)?.status;
  const clearSearch = () => {
    setText("");
    setSearched("");
  };

  return (
    <div className="@container flex h-full min-h-0 flex-col" data-testid="code-files">
      <div className="flex min-h-0 flex-1 flex-col @lg:flex-row">
        <div className="border-border flex h-[40%] min-h-0 shrink-0 flex-col border-b @lg:h-auto @lg:w-56 @lg:border-r @lg:border-b-0 @3xl:w-72">
          <form
            className="border-border flex h-9 shrink-0 items-center gap-1.5 border-b px-3 text-xs"
            onSubmit={(event) => {
              event.preventDefault();
              setSearched(text.trim());
            }}
          >
            <Search className="text-muted-foreground size-3.5 shrink-0" />
            <input
              ref={textInput}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                if (!event.target.value) setSearched("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  clearSearch();
                  event.currentTarget.blur();
                }
              }}
              placeholder="Search in files"
              aria-label="Search in files"
              className="placeholder:text-fg-tertiary min-w-0 flex-1 bg-transparent outline-none"
            />
            {searched ? (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Back to the file tree"
                title="Back to the file tree"
                className="text-muted-foreground hover:text-foreground rounded-md p-0.5"
              >
                <X className="size-3.5" />
              </button>
            ) : (
              <Kbd keys="s" />
            )}
          </form>
          {files.loadError ? (
            <p className="text-destructive px-3 py-2 text-xs">{files.loadError}</p>
          ) : searched ? (
            hits.loadError ? (
              <p className="text-destructive px-3 py-2 text-xs">{hits.loadError}</p>
            ) : hits.data ? (
              <Hits hits={hits.data} query={searched} open={open} onOpen={setOpen} />
            ) : (
              <Spinner className="mx-3 my-2 size-3.5" />
            )
          ) : files.data && (changed.data || changed.loadError) ? (
            <div className="flex min-h-0 flex-1 flex-col pt-1.5">
              <WorktreeTree
                paths={files.data}
                changed={changedFiles}
                open={open}
                onOpen={setOpen}
                focus={focus}
                onFocused={onFocused}
              />
            </div>
          ) : (
            <Spinner className="mx-3 my-2 size-3.5" />
          )}
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {open === null ? (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs">
              <p>Pick a file to read or edit it.</p>
              <p className="flex items-center gap-1.5">
                <Kbd keys="p" /> finds a file by name, <Kbd keys="s" /> searches inside them.
              </p>
            </div>
          ) : file.loadError ? (
            <p className="text-destructive p-3 text-xs">{file.loadError}</p>
          ) : !file.data || file.data.path !== open ? (
            <Spinner className="m-3 size-3.5" />
          ) : file.data.content === null ? (
            <div className="flex flex-col">
              <div className="border-border flex h-9 items-center border-b px-2 text-xs">
                <PathTitle path={open} status={openStatus} />
              </div>
              <p className="text-muted-foreground p-3 text-xs">
                This file is binary or too large to show here.
              </p>
            </div>
          ) : (
            <LightEditor
              key={`${open}:${file.data.content.length}`}
              path={open}
              title={<PathTitle path={open} status={openStatus} />}
              content={file.data.content}
              onCancel={() => setOpen(null)}
              onSave={async (next) => {
                await projectsApi.editFile(threadId, {
                  path: open,
                  original: file.data!.content!,
                  content: next,
                });
                toast.success(`Saved ${open}`);
                await file.refresh();
                await changed.refresh();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
