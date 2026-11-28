import { useEffect, useMemo, useRef } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { GitStatusEntry } from "@pierre/trees";
import { TREE_STYLE } from "./tree-style";
import type { WorkspaceFile } from "./workspace-file";

export const OPEN_SEARCH = "tiny-agents:review-tree-search";

export function Tree({
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
