/**
 * Left column of the Code page (issue #143, ADR 0011). By default grouped
 * the way t3code's sidebar is: by project, then by repository or folder,
 * each group folding away and offering its own New thread (and, for a
 * project, its settings and Threads screen). "Group by repository" off
 * lists every thread flat, newest first, the way Hoplite does. Subagents nest under their
 * parent, with unread dots and search. Hovering a row offers Archive
 * (Restore in the archived view) when its harness archives, which moves the
 * thread together with its subagents, with Undo. **Select** (issue #148)
 * turns the rows into checkboxes to archive or restore many threads at once.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bot,
  ChevronRight,
  Folder,
  FolderGit2,
  FolderTree,
  ListChecks,
  Plus,
  Rows3,
  Search,
  Settings2,
  SquarePen,
  X,
} from "lucide-react";
import { Button, metaLabelClass } from "@groot/ui";
import { Checkbox } from "@groot/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@groot/ui/input-group";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { codeApi, threadPath, type HarnessInfo, type ThreadSummary } from "../../lib/code/api";
import {
  buildGroups,
  buildTree,
  selectionRoots,
  type ListGroup,
  type ListNode,
} from "../../lib/code/list";
import type { ProjectView } from "../../../shared/api/code";
import { PullChip, useArchive, useArchiveMany } from "./controls";
import { shortAgo } from "./NewConversation";

const COLLAPSED_KEY = "tiny-agents:code-collapsed";
const GROUPED_KEY = "tiny-agents:code-grouped";

function readGrouped(): boolean {
  try {
    // Grouped unless turned off in this browser.
    return window.localStorage.getItem(GROUPED_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveGrouped(grouped: boolean) {
  try {
    if (grouped) window.localStorage.removeItem(GROUPED_KEY);
    else window.localStorage.setItem(GROUPED_KEY, "0");
  } catch {
    // not remembered in private mode
  }
}
/** Threads a group shows before "Show more". */
const GROUP_LIMIT = 8;

function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(keys: Set<string>) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...keys]));
  } catch {
    // not remembered in private mode
  }
}

/** Where a group's New thread goes: its project, its folder, or a blank start. */
function newThreadPath(group: ListGroup): string {
  if (group.projectId) return `/code/new?project=${encodeURIComponent(group.projectId)}`;
  if (group.path) return `/code/new?cwd=${encodeURIComponent(group.path)}`;
  return "/code/new";
}

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
              {row.pr && <PullChip pr={row.pr} />}
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

function Group({
  group,
  collapsed,
  onToggle,
  offerNew,
  ...rest
}: RowProps & {
  group: ListGroup;
  collapsed: boolean;
  onToggle(): void;
  /** New thread and settings links (not in the archived view). */
  offerNew: boolean;
}) {
  const [all, setAll] = useState(false);
  const headingId = `code-group-${group.key}`;
  // The open thread stays visible even past the limit.
  const shown = all
    ? group.nodes
    : group.nodes.filter(
        (node, index) =>
          index < GROUP_LIMIT || (rest.activeId ? contains(node, rest.activeId) : false),
      );
  const hidden = group.nodes.length - shown.length;
  const Icon = group.projectId ? FolderGit2 : Folder;
  return (
    <section aria-labelledby={headingId} className="pb-1.5" data-testid="code-group">
      <div className="group/head flex h-8 items-center gap-0.5 rounded-lg pr-1 hover:bg-muted/60">
        <h2 id={headingId} className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            title={group.path ?? group.label}
            className="text-muted-foreground hover:text-foreground flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg px-1 text-left text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronRight
              aria-hidden
              className={cn("size-3.5 shrink-0 transition-transform", !collapsed && "rotate-90")}
            />
            <Icon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{group.label}</span>
          </button>
        </h2>
        {group.projectId && (
          <Button
            asChild
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground opacity-0 group-focus-within/head:opacity-100 group-hover/head:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <Link
              to={`/code/threads?project=${encodeURIComponent(group.projectId)}`}
              aria-label={`${group.label} threads`}
              title="All of its threads"
            >
              <Rows3 />
            </Link>
          </Button>
        )}
        {offerNew && group.projectId && (
          <Button
            asChild
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground opacity-0 group-focus-within/head:opacity-100 group-hover/head:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <Link
              to={`/code/settings/projects/${encodeURIComponent(group.projectId)}`}
              aria-label={`${group.label} settings`}
              title="Project settings"
            >
              <Settings2 />
            </Link>
          </Button>
        )}
        {offerNew && (
          <Button
            asChild
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground opacity-0 group-focus-within/head:opacity-100 group-hover/head:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <Link
              to={newThreadPath(group)}
              aria-label={`New thread in ${group.label}`}
              title="New thread"
            >
              <Plus />
            </Link>
          </Button>
        )}
      </div>
      {!collapsed && shown.length > 0 && (
        <ul className="space-y-px">
          {shown.map((node) => (
            <Row key={node.row.id} node={node} depth={0} {...rest} />
          ))}
        </ul>
      )}
      {!collapsed && hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="text-muted-foreground hover:text-foreground h-7 w-full rounded-lg pl-6 text-left text-xs"
        >
          Show {hidden} more
        </button>
      )}
    </section>
  );
}

export function ConversationList({
  threads,
  harnesses,
  activeId,
  projects = null,
}: {
  threads: ThreadSummary[] | null;
  harnesses: HarnessInfo[];
  activeId?: string;
  /** The owner's projects, each a group even before its first thread (null: none, as for a guest). */
  projects?: ProjectView[] | null;
}) {
  const [view, setView] = useState<"active" | "archived">("active");
  const [archived, setArchived] = useState<ThreadSummary[] | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  useEffect(() => saveCollapsed(collapsed), [collapsed]);
  const [grouped, setGrouped] = useState(readGrouped);
  useEffect(() => saveGrouped(grouped), [grouped]);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ThreadSummary[] | null>(null);
  const caps = useMemo(() => new Map(harnesses.map((h) => [h.id, h.capabilities])), [harnesses]);
  const canArchive = useCallback(
    (row: ThreadSummary) => Boolean(caps.get(row.instanceId)?.threads.archive),
    [caps],
  );
  const labelOf = useCallback(
    (row: ThreadSummary) =>
      harnesses.length > 1 ? harnesses.find((h) => h.id === row.instanceId)?.label : undefined,
    [harnesses],
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
  const groups = useMemo(() => {
    const all = buildGroups(rows ?? [], projects ?? []);
    // An empty project is there to start a thread in, which the archived view does not offer.
    return view === "archived" ? all.filter((g) => g.nodes.length > 0) : all;
  }, [rows, projects, view]);
  const searchTree = useMemo(() => (results ? buildTree(results) : null), [results]);
  // The flat list: working threads first, then newest first.
  const flat = useMemo(
    () =>
      buildTree(rows ?? []).sort(
        (a, b) =>
          Number(b.busy) - Number(a.busy) ||
          Date.parse(b.row.updatedAt) - Date.parse(a.row.updatedAt),
      ),
    [rows],
  );

  // Select mode works on what is on screen: the search results, the list, or the open groups.
  const visible = useMemo(
    () =>
      searchTree ??
      (grouped ? groups.filter((g) => !collapsed.has(g.key)).flatMap((g) => g.nodes) : flat),
    [searchTree, groups, collapsed, grouped, flat],
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
      <div className="flex h-10 shrink-0 items-center gap-0.5 px-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground min-w-0 justify-start"
        >
          <Link to="/code/new" data-testid="code-new" aria-label="New thread">
            <SquarePen />
            New thread
          </Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground min-w-0 justify-start"
        >
          <Link to="/code/threads" data-testid="code-threads">
            <Rows3 />
            Threads
          </Link>
        </Button>
        <span className="flex-1" />
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-label="Search threads"
          title="Search threads"
          aria-pressed={searching}
          onClick={() => {
            setSearching((on) => !on);
            setQuery("");
          }}
        >
          <Search />
        </Button>
        {anyArchives && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label={selected ? "Stop selecting" : "Select threads"}
            title={selected ? "Stop selecting" : "Select threads"}
            aria-pressed={Boolean(selected)}
            onClick={() => setSelected((prev) => (prev ? null : new Set()))}
            data-testid="code-select"
          >
            {selected ? <X /> : <ListChecks />}
          </Button>
        )}
      </div>
      {searching && (
        <div className="shrink-0 px-2 pb-1.5">
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                setQuery("");
                setSearching(false);
              }}
              placeholder="Search threads"
              aria-label="Search threads"
            />
          </InputGroup>
        </div>
      )}
      {view === "archived" && (
        <div className="flex items-center gap-1 px-2 pb-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView("active")}
            className="text-muted-foreground"
            data-testid="code-archived-back"
          >
            <ArrowLeft />
            Archived threads
          </Button>
        </div>
      )}
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
        ) : (grouped ? groups.length : flat.length) === 0 ? (
          <p className="text-muted-foreground p-3 text-sm">
            {view === "archived" ? "No archived threads." : "No threads yet. Start one."}
          </p>
        ) : !grouped ? (
          <ul className="space-y-px">
            {flat.map((node) => (
              <Row key={node.row.id} node={node} depth={0} {...listProps} />
            ))}
          </ul>
        ) : (
          groups.map((group) => (
            <Group
              key={group.key}
              group={group}
              collapsed={collapsed.has(group.key)}
              onToggle={() => toggleGroup(group.key)}
              offerNew={view === "active"}
              {...listProps}
            />
          ))
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
      {!selected && (
        <div className="border-border flex shrink-0 items-center gap-0.5 border-t px-2 py-1.5">
          {anyArchives && (
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={view === "archived"}
              onClick={() => setView((v) => (v === "archived" ? "active" : "archived"))}
              className={cn(view !== "archived" && "text-muted-foreground")}
              data-testid="code-archived-toggle"
            >
              <Archive />
              Archived
            </Button>
          )}
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Group by repository"
            title="Group by repository"
            aria-pressed={grouped}
            onClick={() => setGrouped((on) => !on)}
            className={cn(!grouped && "text-muted-foreground")}
          >
            <FolderTree />
          </Button>
          {projects && (
            <>
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                <Link to="/code/settings" data-testid="code-settings">
                  <Settings2 />
                  Settings
                </Link>
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
