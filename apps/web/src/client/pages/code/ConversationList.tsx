/**
 * Left column of the Code page (issue #143, ADR 0011): every thread of every
 * harness — working now on top, then recent, archived on a toggle — with
 * subagents nested under their parent, unread dots, a harness and a
 * repository filter, and search. Hovering a row offers Archive (Restore in
 * the archived view) when its harness archives, which moves the thread
 * together with its subagents, with Undo. **Select** (issue #148) turns the
 * rows into checkboxes to archive or restore many threads at once.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Bot,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Layers,
  ListChecks,
  Search,
  SquarePen,
  X,
} from "lucide-react";
import { Button, metaLabelClass } from "@groot/ui";
import { Checkbox } from "@groot/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@groot/ui/input-group";
import { cn } from "@groot/ui/lib/utils";
import { SearchSelect } from "../../components/ui/search-select";
import { Spinner } from "../../components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import {
  codeApi,
  shortPath,
  threadPath,
  type HarnessInfo,
  type ThreadSummary,
} from "../../lib/code/api";
import {
  buildSections,
  buildTree,
  repositories,
  selectionRoots,
  type ListNode,
} from "../../lib/code/list";
import { useArchive, useArchiveMany } from "./controls";
import { shortAgo } from "./NewConversation";

const ALL_REPOS = "__all__";
const ALL_HARNESSES = "__all__";

function contains(node: ListNode, id: string): boolean {
  return node.row.id === id || node.children.some((child) => contains(child, id));
}

function countDescendants(node: ListNode): number {
  return node.children.reduce((n, child) => n + 1 + countDescendants(child), 0);
}

/** The list's multi-selection (issue #148); absent outside Select mode. */
interface Selection {
  selected: ReadonlySet<string>;
  /** Ids an ancestor's selection already takes along. */
  covered: ReadonlySet<string>;
  toggle(row: ThreadSummary): void;
}

interface RowProps {
  activeId?: string;
  archivedView: boolean;
  onArchive(node: ListNode): void;
  canArchive(row: ThreadSummary): boolean;
  /** The harness label, when several harnesses share the list. */
  labelOf(row: ThreadSummary): string | undefined;
  selection?: Selection;
}

function Row({
  node,
  depth,
  ...props
}: RowProps & {
  node: ListNode;
  depth: number;
}) {
  const { activeId, archivedView, onArchive, canArchive, labelOf, selection } = props;
  const [open, setOpen] = useState(true);
  const { row } = node;
  const isActive = row.id === activeId;
  const label = depth === 0 ? labelOf(row) : undefined;
  const nested = countDescendants(node);
  const selectable = Boolean(selection) && canArchive(row);
  // A subagent goes along with its selected parent: shown ticked, not its own pick.
  const inherited = Boolean(selection?.covered.has(row.id)) && !selection?.selected.has(row.id);
  const checked = Boolean(selection?.selected.has(row.id)) || inherited;
  return (
    <li>
      <div
        className={cn(
          "group/row relative flex items-stretch rounded-lg",
          isActive || (selection && checked) ? "bg-muted" : "hover:bg-muted",
        )}
        style={{ paddingLeft: depth * 12 }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Hide subagents" : "Show subagents"}
            aria-expanded={open}
            className="text-muted-foreground hover:text-foreground flex w-5 shrink-0 items-center justify-center"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        {selection && (
          <span className="flex w-6 shrink-0 items-center justify-center">
            {selectable && (
              <Checkbox
                checked={checked}
                disabled={inherited}
                onCheckedChange={() => selection.toggle(row)}
                aria-label={`Select ${row.title}`}
                title={inherited ? "Goes with its parent" : undefined}
                data-testid="code-row-select"
              />
            )}
          </span>
        )}
        <Link
          to={threadPath(row.id)}
          aria-current={isActive ? "page" : undefined}
          title={row.preview || row.cwd || undefined}
          onClick={(event) => {
            // In Select mode a click on the row picks it instead of opening it.
            if (!selection) return;
            event.preventDefault();
            if (selectable && !inherited) selection.toggle(row);
          }}
          className="flex h-8 min-w-0 flex-1 items-center rounded-lg pr-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="code-conversation-row"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            {depth > 0 && <Bot className="text-muted-foreground size-3.5 shrink-0" />}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                depth > 0 && "text-muted-foreground",
                (node.unread || isActive) && "text-foreground font-medium",
              )}
            >
              {row.title}
            </span>
            {label && <span className={cn(metaLabelClass, "shrink-0")}>{label}</span>}
            {/* The status / time slot makes room for the archive button on hover. */}
            <span className="flex shrink-0 items-center gap-1.5 pointer-fine:group-focus-within/row:invisible pointer-fine:group-hover/row:invisible">
              {row.working ? (
                <Spinner className="size-3.5" aria-label="Working" />
              ) : node.unread ? (
                <span className="bg-primary size-2 shrink-0 rounded-full" aria-label="Unread" />
              ) : null}
              <span className="text-muted-foreground text-xs tabular-nums">
                {shortAgo(row.updatedAt)}
              </span>
            </span>
          </span>
        </Link>
        {canArchive(row) && !selection && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onArchive(node)}
            aria-label={archivedView ? `Restore ${row.title}` : `Archive ${row.title}`}
            title={
              (archivedView ? "Restore" : "Archive") +
              (nested ? ` with ${nested} ${nested === 1 ? "subagent" : "subagents"}` : "")
            }
            className="text-muted-foreground hover:text-foreground hover:bg-background absolute top-1 right-1 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:hidden"
            data-testid="code-row-archive"
          >
            {archivedView ? <ArchiveRestore /> : <Archive />}
          </Button>
        )}
      </div>
      {open && node.children.length > 0 && (
        <ul className="mt-px space-y-px">
          {node.children.map((child) => (
            <Row key={child.row.id} node={child} depth={depth + 1} {...props} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Section({
  title,
  nodes,
  ...rest
}: RowProps & {
  title: string;
  nodes: ListNode[];
}) {
  if (nodes.length === 0) return null;
  return (
    <section className="pb-2">
      <h2 className={cn(metaLabelClass, "px-3 pt-2 pb-1")}>{title}</h2>
      <ul className="space-y-px">
        {nodes.map((node) => (
          <Row key={node.row.id} node={node} depth={0} {...rest} />
        ))}
      </ul>
    </section>
  );
}

export function ConversationList({
  threads,
  harnesses,
  activeId,
}: {
  threads: ThreadSummary[] | null;
  harnesses: HarnessInfo[];
  activeId?: string;
}) {
  const [view, setView] = useState<"active" | "archived">("active");
  const [archived, setArchived] = useState<ThreadSummary[] | null>(null);
  const [repo, setRepo] = useState<string>(ALL_REPOS);
  const [harnessFilter, setHarnessFilter] = useState<string>(ALL_HARNESSES);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ThreadSummary[] | null>(null);
  const caps = useMemo(() => new Map(harnesses.map((h) => [h.id, h.capabilities])), [harnesses]);
  const canArchive = useCallback(
    (row: ThreadSummary) => Boolean(caps.get(row.instanceId)?.threads.archive),
    [caps],
  );
  const labelOf = useCallback(
    (row: ThreadSummary) =>
      harnesses.length > 1 && harnessFilter === ALL_HARNESSES
        ? harnesses.find((h) => h.id === row.instanceId)?.label
        : undefined,
    [harnesses, harnessFilter],
  );
  const canSearch = harnesses.some((h) => h.capabilities.threads.search);
  const anyArchives = harnesses.some((h) => h.capabilities.threads.archive);
  /** Select mode (issue #148): null when off, else the picked thread ids. */
  const [selected, setSelected] = useState<Set<string> | null>(null);

  // A selection belongs to the view it was made in.
  useEffect(() => setSelected((prev) => (prev ? new Set() : prev)), [view]);

  useEffect(() => {
    if (view !== "archived") return;
    let cancelled = false;
    codeApi
      .list("archived")
      .then((rows) => !cancelled && setArchived(rows))
      .catch(() => !cancelled && setArchived([]));
    return () => {
      cancelled = true;
    };
  }, [view]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    if (!canSearch) {
      // No harness searches: filter the list by title.
      const needle = q.toLowerCase();
      const source = view === "archived" ? archived : threads;
      setResults((source ?? []).filter((t) => t.title.toLowerCase().includes(needle)));
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      codeApi
        .search(q, view === "archived")
        .then((rows) => !cancelled && setResults(Array.isArray(rows) ? rows : []))
        .catch(() => !cancelled && setResults([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, view, canSearch, threads, archived]);

  const archive = useArchive();
  const onArchive = useCallback(
    (node: ListNode) => {
      const restoring = view === "archived";
      // Archiving what is on screen (or its parent) leaves it for the list.
      const leave = !restoring && Boolean(activeId) && contains(node, activeId!);
      void archive(node.row, !restoring, { leave }).then((done) => {
        if (!done || !restoring) return;
        // The archived list is read on demand: drop what was restored.
        const gone = new Set<string>();
        const collect = (n: ListNode) => {
          gone.add(n.row.id);
          n.children.forEach(collect);
        };
        collect(node);
        setArchived((prev) => prev?.filter((r) => !gone.has(r.id)) ?? prev);
      });
    },
    [archive, view, activeId],
  );

  const rows = view === "archived" ? archived : threads;
  const repos = useMemo(() => repositories(rows ?? []), [rows]);
  const sections = useMemo(
    () =>
      buildSections(rows ?? [], {
        repo: repo === ALL_REPOS ? null : repo,
        instanceId: harnessFilter === ALL_HARNESSES ? null : harnessFilter,
      }),
    [rows, repo, harnessFilter],
  );
  const searchTree = useMemo(() => (results ? buildTree(results) : null), [results]);

  // Select mode works on what is on screen: the search results, or the sections.
  const visible = useMemo(
    () => searchTree ?? [...sections.working, ...sections.recent],
    [searchTree, sections],
  );
  const picked = useMemo(
    () => (selected ? selectionRoots(visible, selected) : null),
    [visible, selected],
  );
  const selectableIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (node: ListNode) => {
      if (canArchive(node.row)) ids.push(node.row.id);
      node.children.forEach(walk);
    };
    visible.forEach(walk);
    return ids;
  }, [visible, canArchive]);
  const toggle = useCallback((row: ThreadSummary) => {
    setSelected((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, []);
  const selection = useMemo(
    () => (selected && picked ? { selected, covered: picked.covered, toggle } : undefined),
    [selected, picked, toggle],
  );
  const allPicked = Boolean(picked) && selectableIds.every((id) => picked!.covered.has(id));

  const archiveMany = useArchiveMany();
  const [moving, setMoving] = useState(false);
  const onArchiveSelected = useCallback(async () => {
    if (!picked || picked.roots.length === 0) return;
    const restoring = view === "archived";
    const leave = !restoring && Boolean(activeId) && picked.covered.has(activeId!);
    setMoving(true);
    try {
      const done = new Set(
        await archiveMany(
          picked.roots.map((node) => node.row),
          !restoring,
          { leave },
        ),
      );
      if (done.size === 0) return;
      if (restoring) {
        // The archived list is read on demand: drop what was restored.
        const gone = new Set<string>();
        const collect = (n: ListNode) => {
          gone.add(n.row.id);
          n.children.forEach(collect);
        };
        picked.roots.filter((node) => done.has(node.row.id)).forEach(collect);
        setArchived((prev) => prev?.filter((r) => !gone.has(r.id)) ?? prev);
      }
      setSelected(null);
    } finally {
      setMoving(false);
    }
  }, [picked, view, activeId, archiveMany]);

  const listProps: RowProps = {
    activeId,
    archivedView: view === "archived",
    onArchive,
    canArchive,
    labelOf,
    selection,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-13 shrink-0 items-center gap-1.5 px-2">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Search threads"
            aria-label="Search threads"
          />
        </InputGroup>
        {anyArchives && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={selected ? "Stop selecting" : "Select threads"}
            title={selected ? "Stop selecting" : "Select threads"}
            aria-pressed={Boolean(selected)}
            onClick={() => setSelected((prev) => (prev ? null : new Set()))}
            data-testid="code-select"
          >
            {selected ? <X /> : <ListChecks />}
          </Button>
        )}
        <Button asChild size="icon" variant="ghost" aria-label="New thread" title="New thread">
          <Link to="/code/new" data-testid="code-new">
            <SquarePen />
          </Link>
        </Button>
      </div>
      <div className="flex items-center gap-1 px-2 pb-1">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && setView(v as "active" | "archived")}
          size="sm"
          aria-label="Show"
        >
          <ToggleGroupItem value="active">Active</ToggleGroupItem>
          <ToggleGroupItem value="archived">Archived</ToggleGroupItem>
        </ToggleGroup>
        <span className="flex-1" />
        {harnesses.length > 1 && (
          <SearchSelect
            label="Coding agent"
            value={harnessFilter}
            onValueChange={setHarnessFilter}
            align="end"
            triggerClassName="max-w-32"
            options={[
              { value: ALL_HARNESSES, label: "All agents" },
              ...harnesses.map((h) => ({ value: h.id, label: h.label })),
            ]}
            data-testid="code-harness-filter"
          >
            <Layers className="opacity-70" />
            <span className="truncate">
              {harnessFilter === ALL_HARNESSES
                ? "All"
                : (harnesses.find((h) => h.id === harnessFilter)?.label ?? harnessFilter)}
            </span>
            <ChevronDown className="opacity-50" />
          </SearchSelect>
        )}
        {repos.length > 1 && (
          <SearchSelect
            label="Repository"
            value={repo}
            onValueChange={setRepo}
            align="end"
            searchPlaceholder="Search repositories…"
            emptyText="No repository matches."
            triggerClassName="max-w-40"
            options={[
              { value: ALL_REPOS, label: "All repositories" },
              ...repos.map((r) => ({
                value: r,
                label: shortPath(r),
                description: r,
                keywords: [r],
              })),
            ]}
          >
            <FolderGit2 className="opacity-70" />
            <span className="truncate">{repo === ALL_REPOS ? "All repos" : shortPath(repo)}</span>
            <ChevronDown className="opacity-50" />
          </SearchSelect>
        )}
      </div>
      <nav aria-label="Code threads" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {searchTree ? (
          searchTree.length ? (
            <Section title="Search results" nodes={searchTree} {...listProps} />
          ) : (
            <p className="text-muted-foreground p-3 text-sm">Nothing matches “{query.trim()}”.</p>
          )
        ) : !rows ? (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-3 text-sm">
            {view === "archived" ? "No archived threads." : "No threads yet. Start one."}
          </p>
        ) : (
          <>
            <Section title="Working now" nodes={sections.working} {...listProps} />
            <Section
              title={view === "archived" ? "Archived" : "Recent"}
              nodes={sections.recent}
              {...listProps}
            />
          </>
        )}
      </nav>
      {selected && picked && (
        <div
          className="border-border flex shrink-0 items-center gap-1.5 border-t px-3 py-2"
          role="toolbar"
          aria-label="Selected threads"
          data-testid="code-selection-bar"
        >
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs tabular-nums">
            {picked.roots.length === 0
              ? "Select threads"
              : `${picked.roots.length} selected` +
                (picked.covered.size > picked.roots.length
                  ? ` + ${picked.covered.size - picked.roots.length} ${
                      picked.covered.size - picked.roots.length === 1 ? "subagent" : "subagents"
                    }`
                  : "")}
          </span>
          {selectableIds.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(allPicked ? new Set() : new Set(selectableIds))}
            >
              {allPicked ? "Clear" : "Select all"}
            </Button>
          )}
          <Button
            size="sm"
            disabled={picked.roots.length === 0 || moving}
            onClick={() => void onArchiveSelected()}
            data-testid="code-archive-selected"
          >
            {view === "archived" ? <ArchiveRestore /> : <Archive />}
            {view === "archived" ? "Restore" : "Archive"}
          </Button>
        </div>
      )}
    </div>
  );
}
