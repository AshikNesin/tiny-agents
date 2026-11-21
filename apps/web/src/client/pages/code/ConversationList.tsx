import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bot,
  ChevronRight,
  GitPullRequest,
  MoreHorizontal,
  Plus,
  Rows3,
  Search,
  Settings2,
  SquarePen,
  X,
} from "lucide-react";
import { Button, metaLabelClass } from "@groot/ui";
import { Checkbox } from "@groot/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@groot/ui/input-group";
import { cn } from "@groot/ui/lib/utils";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Spinner } from "../../components/ui/spinner";
import { RESOURCE_QUERY, wait } from "../../queries/resource";
import { codeApi, threadPath, type HarnessInfo, type ThreadSummary } from "../../lib/code/api";
import {
  buildGroups,
  buildTree,
  selectionRoots,
  type ListGroup,
  type ListNode,
} from "../../lib/code/list";
import type { ProjectView } from "../../../shared/api/code";
import { SIDEBAR_ROW, SidebarFold } from "../../components/shell/ModeSwitch";
import { PullChip, useArchive, useArchiveMany } from "./controls";
import { shortAgo } from "./NewConversation";

const COLLAPSED_KEY = "tiny-agents:code-collapsed";

const navRow = (active: boolean) =>
  cn(SIDEBAR_ROW, active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent");
const GROUPED_KEY = "tiny-agents:code-grouped";

function readGrouped(): boolean {
  try {
    return window.localStorage.getItem(GROUPED_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveGrouped(grouped: boolean) {
  try {
    if (grouped) window.localStorage.removeItem(GROUPED_KEY);
    else window.localStorage.setItem(GROUPED_KEY, "0");
  } catch {}
}
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
  } catch {}
}

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

interface Selection {
  selected: ReadonlySet<string>;
  covered: ReadonlySet<string>;
  toggle(row: ThreadSummary): void;
}

interface RowProps {
  activeId?: string;
  archivedView: boolean;
  onArchive(node: ListNode): void;
  canArchive(row: ThreadSummary): boolean;
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
  const inherited = Boolean(selection?.covered.has(row.id)) && !selection?.selected.has(row.id);
  const checked = Boolean(selection?.selected.has(row.id)) || inherited;
  return (
    <li>
      <div
        className={cn(
          "group/row relative flex items-stretch rounded-xl",
          isActive || (selection && checked) ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
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
            if (!selection) return;
            event.preventDefault();
            if (selectable && !inherited) selection.toggle(row);
          }}
          className="flex h-8 min-w-0 flex-1 items-center rounded-xl pr-2 outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
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
            <span className="flex shrink-0 items-center gap-1.5 pointer-fine:group-focus-within/row:invisible pointer-fine:group-hover/row:invisible">
              {row.pr?.loop === "needs_input" && <PullChip pr={row.pr} />}
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
            className="text-muted-foreground hover:text-foreground hover:bg-sidebar absolute top-1 right-1 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:hidden"
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
  nodes,
  ...rest
}: RowProps & {
  nodes: ListNode[];
}) {
  if (nodes.length === 0) return null;
  return (
    <section aria-label="Search results" className="pb-2">
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
  offerNew: boolean;
}) {
  const [all, setAll] = useState(false);
  const headingId = `code-group-${group.key}`;
  const shown = all
    ? group.nodes
    : group.nodes.filter(
        (node, index) =>
          index < GROUP_LIMIT || (rest.activeId ? contains(node, rest.activeId) : false),
      );
  const hidden = group.nodes.length - shown.length;
  return (
    <section aria-labelledby={headingId} className="pb-1.5" data-testid="code-group">
      <div className="group/head flex h-8 items-center gap-0.5 rounded-xl pr-1">
        <h2 id={headingId} className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            title={group.path ?? group.label}
            className="text-muted-foreground hover:text-foreground flex h-8 w-full min-w-0 items-center gap-1.5 rounded-xl px-1 text-left text-xs font-medium outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          >
            <ChevronRight
              aria-hidden
              className={cn("size-3.5 shrink-0 transition-transform", !collapsed && "rotate-90")}
            />
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
          className="text-muted-foreground hover:text-foreground h-7 w-full rounded-xl pl-6 text-left text-xs"
        >
          Show {hidden} more
        </button>
      )}
    </section>
  );
}

const ARCHIVED_KEY = ["code", "threads", "archived"];

export function ConversationList({
  threads,
  harnesses,
  activeId,
  projects = null,
  onHide,
}: {
  threads: ThreadSummary[] | null;
  harnesses: HarnessInfo[];
  activeId?: string;
  projects?: ProjectView[] | null;
  onHide?: () => void;
}) {
  const { pathname } = useLocation();
  const at = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  const [view, setView] = useState<"active" | "archived">("active");
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
  const [selected, setSelected] = useState<Set<string> | null>(null);

  useEffect(() => setSelected((prev) => (prev ? new Set() : prev)), [view]);

  const archivedQuery = useQuery({
    queryKey: ARCHIVED_KEY,
    queryFn: () => codeApi.list("archived").catch((): ThreadSummary[] => []),
    enabled: view === "archived",
    ...RESOURCE_QUERY,
  });
  const archived = archivedQuery.data ?? null;
  const queryClient = useQueryClient();
  const setArchived = useCallback(
    (update: (rows: ThreadSummary[] | undefined) => ThreadSummary[] | undefined) =>
      queryClient.setQueryData<ThreadSummary[]>(ARCHIVED_KEY, update),
    [queryClient],
  );

  const q = query.trim();
  const inArchived = view === "archived";
  const searched = useQuery({
    queryKey: ["code", "threads", "search", q, inArchived],
    queryFn: async ({ signal }) => {
      await wait(200, signal);
      return codeApi
        .search(q, inArchived)
        .then((rows) => (Array.isArray(rows) ? rows : []))
        .catch((): ThreadSummary[] => []);
    },
    enabled: canSearch && q.length >= 2,
    placeholderData: keepPreviousData,
    ...RESOURCE_QUERY,
  });
  const results = useMemo(() => {
    if (q.length < 2) return null;
    if (canSearch) return searched.data ?? null;
    const needle = q.toLowerCase();
    const source = inArchived ? archived : threads;
    return (source ?? []).filter((t) => t.title.toLowerCase().includes(needle));
  }, [q, canSearch, searched.data, inArchived, archived, threads]);

  const archive = useArchive();
  const onArchive = useCallback(
    (node: ListNode) => {
      const restoring = view === "archived";
      const leave = !restoring && Boolean(activeId) && contains(node, activeId!);
      void archive(node.row, !restoring, { leave }).then((done) => {
        if (!done || !restoring) return;
        const gone = new Set<string>();
        const collect = (n: ListNode) => {
          gone.add(n.row.id);
          n.children.forEach(collect);
        };
        collect(node);
        setArchived((prev) => prev?.filter((r) => !gone.has(r.id)));
      });
    },
    [archive, view, activeId, setArchived],
  );

  const rows = view === "archived" ? archived : threads;
  const groups = useMemo(() => {
    const all = buildGroups(rows ?? [], projects ?? []);
    return view === "archived" ? all.filter((g) => g.nodes.length > 0) : all;
  }, [rows, projects, view]);
  const searchTree = useMemo(() => (results ? buildTree(results) : null), [results]);
  const flat = useMemo(
    () =>
      buildTree(rows ?? []).sort(
        (a, b) =>
          Number(b.busy) - Number(a.busy) ||
          Date.parse(b.row.updatedAt) - Date.parse(a.row.updatedAt),
      ),
    [rows],
  );

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
        const gone = new Set<string>();
        const collect = (n: ListNode) => {
          gone.add(n.row.id);
          n.children.forEach(collect);
        };
        picked.roots.filter((node) => done.has(node.row.id)).forEach(collect);
        setArchived((prev) => prev?.filter((r) => !gone.has(r.id)));
      }
      setSelected(null);
    } finally {
      setMoving(false);
    }
  }, [picked, view, activeId, archiveMany, setArchived]);

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
      <nav aria-label="Code" className="shrink-0 space-y-0.5 px-2.5 pb-2">
        <Link
          to="/code/new"
          data-testid="code-new"
          aria-label="New thread"
          aria-current={at("/code/new") ? "page" : undefined}
          className={navRow(at("/code/new"))}
        >
          <SquarePen />
          New thread
        </Link>
        {!searching && (
          <button
            type="button"
            className={navRow(false)}
            aria-label="Search threads"
            onClick={() => {
              setSearching(true);
              setQuery("");
            }}
          >
            <Search />
            Search
          </button>
        )}
        {searching && (
          <InputGroup className="h-9 rounded-xl">
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
              onBlur={() => !query && setSearching(false)}
              placeholder="Search threads"
              aria-label="Search threads"
            />
          </InputGroup>
        )}
        <Link
          to="/code/threads"
          data-testid="code-threads"
          aria-current={at("/code/threads") ? "page" : undefined}
          className={navRow(at("/code/threads"))}
        >
          <Rows3 />
          Threads
        </Link>
        <Link
          to="/code/reviews"
          data-testid="code-reviews"
          aria-current={at("/code/reviews") ? "page" : undefined}
          className={navRow(at("/code/reviews"))}
        >
          <GitPullRequest />
          Reviews
        </Link>
      </nav>
      <div className="flex h-8 shrink-0 items-center gap-1 px-4 pt-2">
        {view === "archived" ? (
          <button
            type="button"
            onClick={() => setView("active")}
            className="text-fg-tertiary hover:text-foreground flex min-w-0 items-center gap-1 text-sm font-medium"
            data-testid="code-archived-back"
          >
            <ArrowLeft className="size-3.5" />
            Archived threads
          </button>
        ) : (
          <h2 className="text-fg-tertiary text-sm font-medium select-none">
            {searchTree ? "Search results" : grouped ? "Projects" : "Recent"}
          </h2>
        )}
        <span className="flex-1" />
        {!selected && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex size-6 items-center justify-center rounded-lg"
                aria-label="List options"
                title="List options"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuCheckboxItem
                checked={grouped}
                onCheckedChange={(on) => setGrouped(on === true)}
              >
                Group by repository
              </DropdownMenuCheckboxItem>
              {anyArchives && (
                <DropdownMenuCheckboxItem
                  checked={view === "archived"}
                  onCheckedChange={(on) => setView(on === true ? "archived" : "active")}
                  data-testid="code-archived-toggle"
                >
                  Show archived
                </DropdownMenuCheckboxItem>
              )}
              {anyArchives && (
                <DropdownMenuItem onSelect={() => setSelected(new Set())} data-testid="code-select">
                  Select threads
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <nav aria-label="Code threads" className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {searchTree ? (
          searchTree.length ? (
            <Section nodes={searchTree} {...listProps} />
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
            size="icon-sm"
            variant="ghost"
            aria-label="Stop selecting"
            title="Stop selecting"
            onClick={() => setSelected(null)}
          >
            <X />
          </Button>
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
      {!selected && (projects || onHide) && (
        <div className="flex shrink-0 items-center gap-1 p-2.5">
          {projects ? (
            <Link
              to="/code/settings"
              data-testid="code-settings"
              aria-current={at("/code/settings") ? "page" : undefined}
              className={cn(navRow(at("/code/settings")), "min-w-0 flex-1")}
            >
              <Settings2 />
              Settings
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          {onHide && <SidebarFold label="Hide sidebar" onClick={onHide} controls="code-sidebar" />}
        </div>
      )}
    </div>
  );
}
