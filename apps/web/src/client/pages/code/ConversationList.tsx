/**
 * Left column of the Code page (issue #143): every Shelley conversation —
 * working now on top, then recent, archived on a toggle — with subagents
 * nested under their parent, unread dots, a repository filter and search.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Plus, Search } from "lucide-react";
import { Button, Input, metaLabelClass } from "@groot/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { cn } from "@groot/ui/lib/utils";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import { Spinner } from "../../components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import {
  conversationTitle,
  shelleyApi,
  shortPath,
  type ShelleyConversation,
} from "../../lib/shelley/api";
import { buildSections, buildTree, repositories, type ListNode } from "../../lib/shelley/list";

const ALL_REPOS = "__all__";

function Row({ node, activeId, depth }: { node: ListNode; activeId?: string; depth: number }) {
  const [open, setOpen] = useState(true);
  const { row } = node;
  const isActive = row.conversation_id === activeId;
  return (
    <li>
      <div className="flex items-stretch" style={{ paddingLeft: depth * 14 }}>
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
          to={`/code/${row.conversation_id}`}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg px-2 py-1.5",
            isActive ? "bg-muted" : "hover:bg-muted",
          )}
          data-testid="code-conversation-row"
        >
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                (node.unread || isActive) && "font-medium",
              )}
            >
              {conversationTitle(row)}
            </span>
            {row.working ? (
              <Spinner className="size-3.5" aria-label="Working" />
            ) : node.unread ? (
              <span className="bg-primary size-2 shrink-0 rounded-full" aria-label="Unread" />
            ) : null}
          </span>
          {depth === 0 && (
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate">
                {row.preview || shortPath(row.cwd) || "—"}
              </span>
              <span className="shrink-0">{formatRelativeTime(row.updated_at)}</span>
            </span>
          )}
        </Link>
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Row
              key={child.row.conversation_id}
              node={child}
              activeId={activeId}
              depth={depth + 1}
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
  activeId,
}: {
  title: string;
  nodes: ListNode[];
  activeId?: string;
}) {
  if (nodes.length === 0) return null;
  return (
    <section className="py-1">
      <h2 className={cn(metaLabelClass, "px-3 py-1")}>{title}</h2>
      <ul>
        {nodes.map((node) => (
          <Row key={node.row.conversation_id} node={node} activeId={activeId} depth={0} />
        ))}
      </ul>
    </section>
  );
}

export function ConversationList({
  conversations,
  activeId,
}: {
  conversations: ShelleyConversation[] | null;
  activeId?: string;
}) {
  const [view, setView] = useState<"active" | "archived">("active");
  const [archived, setArchived] = useState<ShelleyConversation[] | null>(null);
  const [repo, setRepo] = useState<string>(ALL_REPOS);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ShelleyConversation[] | null>(null);

  useEffect(() => {
    if (view !== "archived") return;
    let cancelled = false;
    shelleyApi
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
    let cancelled = false;
    const timer = setTimeout(() => {
      shelleyApi
        .search(q, view === "archived")
        .then((rows) => !cancelled && setResults(Array.isArray(rows) ? rows : []))
        .catch(() => !cancelled && setResults([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, view]);

  const rows = view === "archived" ? archived : conversations;
  const repos = useMemo(() => repositories(rows ?? []), [rows]);
  const sections = useMemo(
    () => buildSections(rows ?? [], { repo: repo === ALL_REPOS ? null : repo }),
    [rows, repo],
  );
  const searchTree = useMemo(() => (results ? buildTree(results) : null), [results]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 p-2">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="pl-8"
            />
          </div>
          <Button
            asChild
            size="icon"
            variant="outline"
            aria-label="New conversation"
            title="New conversation"
          >
            <Link to="/code" data-testid="code-new">
              <Plus />
            </Link>
          </Button>
        </div>
        <div className="flex items-center gap-2">
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
          {repos.length > 1 && (
            <Select value={repo} onValueChange={setRepo}>
              <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Repository">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_REPOS}>All repositories</SelectItem>
                {repos.map((r) => (
                  <SelectItem key={r} value={r}>
                    {shortPath(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <nav aria-label="Shelley conversations" className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        {searchTree ? (
          searchTree.length ? (
            <Section title="Search results" nodes={searchTree} activeId={activeId} />
          ) : (
            <p className="text-muted-foreground p-3 text-sm">Nothing matches “{query.trim()}”.</p>
          )
        ) : !rows ? (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-3 text-sm">
            {view === "archived"
              ? "No archived conversations."
              : "No conversations yet. Start one."}
          </p>
        ) : (
          <>
            <Section title="Working now" nodes={sections.working} activeId={activeId} />
            <Section
              title={view === "archived" ? "Archived" : "Recent"}
              nodes={sections.recent}
              activeId={activeId}
            />
          </>
        )}
      </nav>
    </div>
  );
}
