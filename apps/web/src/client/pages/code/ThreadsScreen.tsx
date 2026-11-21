import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  GitPullRequest,
  Search,
  SquarePen,
} from "lucide-react";
import { Button } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@groot/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { Spinner } from "../../components/ui/spinner";
import { codeApi, threadPath, type ThreadSummary } from "../../lib/code/api";
import { buildTree, statusSections, type ListNode, type StatusSection } from "../../lib/code/list";
import type { ProjectView } from "../../../shared/api/code";
import { RESOURCE_QUERY } from "../../queries/resource";
import { PullChip } from "./controls";

const TONE: Record<StatusSection["key"] | "archived", string> = {
  working: "bg-muted/70 text-foreground",
  "needs-you": "bg-warning/10 text-warning",
  review: "bg-muted/70 text-foreground",
  done: "bg-success/10 text-success",
  archived: "bg-muted/50 text-muted-foreground",
};

function StatusGlyph({ section }: { section: StatusSection["key"] | "archived" }) {
  if (section === "working") return <Spinner className="size-3.5" aria-label="Working" />;
  if (section === "needs-you") return <CircleAlert className="text-warning size-3.5" />;
  if (section === "review") return <GitPullRequest className="text-muted-foreground size-3.5" />;
  if (section === "done") return <CircleCheck className="text-success size-3.5" />;
  return <CircleCheck className="text-muted-foreground size-3.5" />;
}

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Rows({
  nodes,
  section,
  projectName,
}: {
  nodes: ListNode[];
  section: StatusSection["key"] | "archived";
  projectName(row: ThreadSummary): string | undefined;
}) {
  return (
    <ul className="space-y-px py-1">
      {nodes.map(({ row }) => {
        const where = projectName(row);
        return (
          <li key={row.id}>
            <Link
              to={threadPath(row.id)}
              className="hover:bg-muted/60 flex h-10 items-center gap-3 rounded-lg px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span
                className="flex w-4 shrink-0 justify-center"
                aria-hidden={section !== "working"}
              >
                <StatusGlyph section={section} />
              </span>
              <span className={cn("min-w-0 flex-1 truncate", row.unread && "font-medium")}>
                {row.title}
              </span>
              {where && (
                <span className="text-muted-foreground hidden shrink-0 text-xs sm:inline">
                  {where}
                </span>
              )}
              {row.pr && <PullChip pr={row.pr} />}
              <span className="text-muted-foreground w-14 shrink-0 text-right text-xs tabular-nums">
                {dateOf(row.updatedAt)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Section({
  sectionKey,
  label,
  count,
  open,
  onToggle,
  children,
}: {
  sectionKey: StatusSection["key"] | "archived";
  label: string;
  count: number | null;
  open: boolean;
  onToggle(): void;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="space-y-0.5">
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            TONE[sectionKey],
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
          />
          {label}
          {count !== null && <span className="font-normal opacity-70 tabular-nums">{count}</span>}
        </button>
      </h2>
      {open && children}
    </section>
  );
}

export function ThreadsScreen({
  threads,
  projects,
}: {
  threads: ThreadSummary[] | null;
  projects: ProjectView[] | null;
}) {
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project");
  const project = projectId ? projects?.find((p) => p.id === projectId) : undefined;
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [archivedOpen, setArchivedOpen] = useState(false);
  const archived =
    useQuery({
      queryKey: ["code", "threads", "archived"],
      queryFn: () => codeApi.list("archived").catch((): ThreadSummary[] => []),
      enabled: archivedOpen,
      ...RESOURCE_QUERY,
      staleTime: Infinity,
    }).data ?? null;

  const keep = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (row: ThreadSummary) =>
      (!projectId || row.projectId === projectId) &&
      (!needle || row.title.toLowerCase().includes(needle));
  }, [projectId, query]);
  const sections = useMemo(() => statusSections((threads ?? []).filter(keep)), [threads, keep]);
  const archivedNodes = useMemo(
    () => (archived ? buildTree(archived.filter(keep)) : null),
    [archived, keep],
  );
  const projectName = (row: ThreadSummary) =>
    projectId ? undefined : (projects?.find((p) => p.id === row.projectId)?.name ?? undefined);
  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const pick = (id: string | null) => setParams(id ? { project: id } : {}, { replace: true });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className={cn("border-border flex h-13 shrink-0 items-center gap-2 border-b px-3 sm:px-4")}
      >
        <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground md:hidden">
          <Link to="/code" aria-label="Back" title="Back">
            <ArrowLeft />
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="hover:bg-muted aria-expanded:bg-muted flex h-8 max-w-[45%] shrink-0 items-center gap-1 rounded-lg px-2 outline-none sm:max-w-none focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="Project"
            >
              <h1 className="truncate text-sm font-medium">{project?.name ?? "All threads"}</h1>
              <ChevronRight aria-hidden className="text-muted-foreground size-3.5 rotate-90" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={() => pick(null)}>All threads</DropdownMenuItem>
            {(projects ?? []).map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => pick(p.id)}>
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="hidden flex-1 sm:block" />
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground shrink-0">
          <Link to={projectId ? `/code/new?project=${encodeURIComponent(projectId)}` : "/code/new"}>
            <SquarePen />
            <span className="hidden sm:inline">New thread</span>
          </Link>
        </Button>
        <InputGroup className="min-w-0 flex-1 sm:w-64 sm:flex-none">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads"
            aria-label="Search threads"
          />
        </InputGroup>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-3 px-3 py-4 sm:px-6">
          {!threads ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : sections.length === 0 ? (
            <p className="text-muted-foreground px-3 text-sm">
              {query.trim() ? `Nothing matches “${query.trim()}”.` : "No threads here yet."}
            </p>
          ) : (
            sections.map((section) => (
              <Section
                key={section.key}
                sectionKey={section.key}
                label={section.label}
                count={section.nodes.length}
                open={!closed.has(section.key)}
                onToggle={() => toggle(section.key)}
              >
                <Rows nodes={section.nodes} section={section.key} projectName={projectName} />
              </Section>
            ))
          )}
          <Section
            sectionKey="archived"
            label="Archived"
            count={archivedNodes ? archivedNodes.length : null}
            open={archivedOpen}
            onToggle={() => setArchivedOpen((o) => !o)}
          >
            {archivedNodes ? (
              archivedNodes.length > 0 ? (
                <Rows nodes={archivedNodes} section="archived" projectName={projectName} />
              ) : (
                <p className="text-muted-foreground px-3 py-2 text-sm">No archived threads.</p>
              )
            ) : (
              <div className="flex justify-center p-3">
                <Spinner />
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
