/**
 * Left column of the Code page (issue #143, ADR 0011): every thread of every
 * harness — working now on top, then recent, archived on a toggle — with
 * subagents nested under their parent, unread dots, a harness and a
 * repository filter, and search. Hovering a row offers Archive (Restore in
 * the archived view) when its harness archives, which moves the thread
 * together with its subagents, with Undo.
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
  Search,
  SquarePen,
} from "lucide-react";
import { Button, metaLabelClass } from "@groot/ui";
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
import { buildSections, buildTree, repositories, type ListNode } from "../../lib/code/list";
import { useArchive } from "./controls";
import { shortAgo } from "./NewConversation";

const ALL_REPOS = "__all__";
const ALL_HARNESSES = "__all__";

function contains(node: ListNode, id: string): boolean {
  return node.row.id === id || node.children.some((child) => contains(child, id));
}

function countDescendants(node: ListNode): number {
  return node.children.reduce((n, child) => n + 1 + countDescendants(child), 0);
}

function Row({
  node,
  activeId,
  depth,
  archivedView,
  onArchive,
  canArchive,
  labelOf,
}: {
  node: ListNode;
  activeId?: string;
  depth: number;
  archivedView: boolean;
  onArchive(node: ListNode): void;
  canArchive(row: ThreadSummary): boolean;
  /** The harness label, when several harnesses share the list. */
  labelOf(row: ThreadSummary): string | undefined;
}) {
  const [open, setOpen] = useState(true);
  const { row } = node;
  const isActive = row.id === activeId;
  const label = depth === 0 ? labelOf(row) : undefined;
  const nested = countDescendants(node);
  return (
    <li>
      <div
        className={cn(
          "group/row relative flex items-stretch rounded-lg",
          isActive ? "bg-muted" : "hover:bg-muted",
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
        <Link
          to={threadPath(row.id)}
          aria-current={isActive ? "page" : undefined}
          title={row.preview || row.cwd || undefined}
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
        {canArchive(row) && (
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
            <Row
              key={child.row.id}
              node={child}
              activeId={activeId}
              depth={depth + 1}
              archivedView={archivedView}
              onArchive={onArchive}
              canArchive={canArchive}
              labelOf={labelOf}
            />
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
}: {
  title: string;
  nodes: ListNode[];
  activeId?: string;
  archivedView: boolean;
  onArchive(node: ListNode): void;
  canArchive(row: ThreadSummary): boolean;
  labelOf(row: ThreadSummary): string | undefined;
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

  const listProps = {
    activeId,
    archivedView: view === "archived",
    onArchive,
    canArchive,
    labelOf,
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
    </div>
  );
}
