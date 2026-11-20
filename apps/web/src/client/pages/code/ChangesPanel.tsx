/**
 * The Changes panel (issue #143, ADR 0011): what the agent changed in the thread's
 * working directory, uncommitted changes or a recent commit (searchable), in
 * the diff workspace (`DiffWorkspace`): one column of every changed file under
 * sticky headers, generated files folded, and the file tree in a drawer
 * (Files), or beside the column on the Review page. A line's gutter offers
 * Comment: the comment waits under its line and above the thread's composer,
 * and goes to the agent with the next message. Diffs come from the thread's
 * harness (capability `workspace.diffs`).
 */
import { useCallback, useMemo, useState } from "react";
import { ChevronDown, FileDiff as FileDiffIcon } from "lucide-react";
import { keepPreviousData } from "@tanstack/react-query";
import { EmptyState } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import { SearchSelect, type SearchSelectOption } from "../../components/ui/search-select";
import { codeApi, type GitDiff, type GitFile } from "../../lib/code/api";
import { useRefreshOn, useResource } from "../../queries/resource";
import type { ThreadCommenting } from "../../lib/code/comments";
import { useSteadyKey } from "../../lib/code/use-live-changes";
import {
  DiffViewButtons,
  DiffWorkspace,
  FilesButton,
  treeOrder,
  useDiffView,
} from "./DiffWorkspace";

export function ChangesPanel({
  instanceId,
  cwd,
  refreshKey,
  commenting,
  page = false,
}: {
  instanceId: string;
  cwd: string;
  /** Changes when the files may have changed (a pushed version, or transcript activity). */
  refreshKey: unknown;
  /** The thread's line comments: absent, the diff takes none. */
  commenting?: ThreadCommenting;
  /** At full width on the Review page: the tree beside the column. */
  page?: boolean;
}) {
  const [diffId, setDiffId] = useState<string>("working");
  const [reload, setReload] = useState(0);
  // Re-read on a steady beat while the key moves (a pushed change, or transcript activity).
  const settledKey = useSteadyKey(refreshKey);

  // Every read lands as a new list, so the scope is checked against each one.
  const diffList = useResource(
    ["code", "diffs", instanceId, cwd],
    async () => (await codeApi.diffs(instanceId, cwd)).diffs ?? [],
    "Could not read the changes.",
    { structuralSharing: false, placeholderData: keepPreviousData },
  );
  const diffs = diffList.data;
  // Each list that lands keeps the scope if it still has changes, else picks
  // one that does, before its files are read.
  const [checked, setChecked] = useState<GitDiff[] | null>(null);
  if (diffs && diffs !== checked) {
    setChecked(diffs);
    if (!diffs.some((d) => d.id === diffId && (d.id !== "working" || d.filesCount > 0))) {
      const working = diffs.find((d) => d.id === "working" && d.filesCount > 0);
      setDiffId(working?.id ?? diffs.find((d) => d.id !== "working")?.id ?? "working");
    }
  }
  // The files of the scope shown: a re-read of the same scope swaps them in
  // place, so the list (and what was folded) never blinks out.
  const fileList = useResource(
    ["code", "diff-files", instanceId, cwd, diffId],
    async () => {
      const list = await codeApi.diffFiles(instanceId, diffId, cwd);
      return Array.isArray(list) ? list : [];
    },
    "Could not list the files.",
    { enabled: diffs !== null },
  );
  const files: GitFile[] | null = fileList.data;
  const error = diffList.loadError ?? fileList.loadError;
  const refreshDiffs = diffList.refresh;
  const refreshFiles = fileList.refresh;
  const readAgain = useCallback(async () => {
    await refreshDiffs();
    await refreshFiles();
  }, [refreshDiffs, refreshFiles]);
  useRefreshOn(`${String(settledKey)}\u0000${reload}`, readAgain);

  const selected = diffs?.find((d) => d.id === diffId);
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

  // A file's content is named by its counts: the agent's next write reads it again.
  const shownFiles = useMemo(
    () =>
      diffs?.length === 0
        ? []
        : files && treeOrder(files).map((f) => ({ ...f, hash: `${f.additions}:${f.deletions}` })),
    [diffs, files],
  );
  const read = useCallback(
    (path: string) => codeApi.fileDiff(instanceId, diffId, cwd, path),
    [instanceId, diffId, cwd],
  );
  const view = useDiffView();

  const picker =
    diffs && diffs.length > 0 ? (
      <SearchSelect
        label="Changes to show"
        value={diffId}
        onValueChange={setDiffId}
        options={diffOptions}
        searchPlaceholder="Search commits…"
        contentClassName="w-96"
        triggerClassName={cn(
          "text-foreground h-8",
          page ? "w-full justify-start text-xs" : "max-w-full text-sm",
        )}
        data-testid="code-diff-select"
      >
        <FileDiffIcon className="text-muted-foreground size-4" />
        <span className="min-w-0 flex-1 truncate text-left">
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
    );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-changes">
      {page && (
        <div className="border-border flex h-10 shrink-0 items-center gap-1 border-b px-2">
          <FilesButton view={view} />
          <span className="flex-1" />
          {view.wide && <DiffViewButtons view={view} />}
        </div>
      )}
      <DiffWorkspace
        testId="code-changes-files"
        layout={page ? "page" : "panel"}
        files={!diffs ? null : shownFiles}
        error={error}
        scopeKey={`${instanceId}\u0000${cwd}\u0000${diffId}`}
        readKey={`${String(settledKey)}:${reload}`}
        read={read}
        diffStyle={page && view.wide ? view.style : "unified"}
        collapse={view.collapse}
        drawer={page ? view.drawer : undefined}
        commenting={commenting}
        scope={picker}
        onRefresh={() => setReload((n) => n + 1)}
        empty={
          diffs?.length === 0 ? (
            <EmptyState
              icon={FileDiffIcon}
              title="Nothing to show"
              description="Not a git repository, or no commits yet."
            />
          ) : (
            <EmptyState
              icon={FileDiffIcon}
              title="No changes"
              description="The working tree is clean. Pick a commit above to review it."
            />
          )
        }
      />
    </div>
  );
}
