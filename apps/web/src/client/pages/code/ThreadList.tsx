import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Plus, Settings, TriangleAlert } from "lucide-react";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { SidebarTop } from "../../components/shell/ModeSwitch";
import { codeApi, threadPath, type HarnessInfo, type ThreadSummary } from "../../lib/code/api";
import { statusSections, type ListNode, type StatusSection } from "../../lib/code/list";
import type { ProjectView } from "../../../shared/api/code";
import { useResource } from "../../queries/resource";
import { PullChip } from "./controls";
import { Kbd } from "./keys";

const DOT: Record<StatusSection["key"], string> = {
  "needs-you": "bg-warning",
  working: "bg-info animate-pulse motion-reduce:animate-none",
  review: "bg-success",
  done: "bg-muted-foreground/40",
};

function metaOf(node: ListNode, section: StatusSection["key"]): string {
  const { row } = node;
  if (section === "needs-you" && row.pr?.loop === "needs_input") return "needs you";
  if (section === "working" && row.pr?.loop === "fixing") return "fixing";
  if (row.queuedCount) return `${row.queuedCount} queued`;
  return "";
}

function Row({
  node,
  section,
  active,
  project,
}: {
  node: ListNode;
  section: StatusSection["key"];
  active: boolean;
  project?: string;
}) {
  const { row } = node;
  const meta = metaOf(node, section);
  return (
    <Link
      to={threadPath(row.id)}
      aria-current={active ? "page" : undefined}
      data-testid="code-thread-row"
      data-thread={row.id}
      className={cn(
        "group flex h-8 items-center gap-2 rounded-lg px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[section])} aria-hidden />
      <span className={cn("min-w-0 flex-1 truncate", node.unread && "font-medium")}>
        {row.title || "Untitled"}
      </span>
      {meta && <span className="text-muted-foreground shrink-0 text-xs">{meta}</span>}
      {row.pr ? (
        <PullChip pr={row.pr} />
      ) : (
        project && (
          <span className="text-muted-foreground/70 max-w-20 shrink-0 truncate text-xs">
            {project}
          </span>
        )
      )}
    </Link>
  );
}

function Archived({ activeId }: { activeId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="pt-1">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        data-testid="code-archived-toggle"
        className="text-muted-foreground hover:text-foreground flex h-7 w-full items-center gap-1 px-2 text-xs font-medium"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        Archived
      </button>
      {open && <ArchivedRows activeId={activeId} />}
    </section>
  );
}

function ArchivedRows({ activeId }: { activeId?: string }) {
  const { data } = useResource(
    ["code", "threads", "archived"],
    () => codeApi.list("archived"),
    "Could not load archived threads.",
  );
  if (!data) return <Spinner className="mx-2 my-1 size-3.5" />;
  const rows = data.filter((row) => !row.parentId && !row.review);
  if (rows.length === 0) return <p className="text-muted-foreground px-2 py-1 text-xs">None.</p>;
  return (
    <div className="space-y-px">
      {rows.map((row) => (
        <Row
          key={row.id}
          node={{ row, children: [], busy: false, unread: false }}
          section="done"
          active={row.id === activeId}
        />
      ))}
    </div>
  );
}

export function ThreadList({
  threads,
  harnesses,
  projects,
  activeId,
}: {
  threads: ThreadSummary[] | null;
  harnesses: HarnessInfo[];
  projects?: ProjectView[] | null;
  activeId?: string;
}) {
  const sections = useMemo(() => statusSections(threads ?? []), [threads]);
  const projectName = (id?: string | null) =>
    (projects?.length ?? 0) > 1 ? projects?.find((p) => p.id === id)?.name : undefined;
  const offline = harnesses.filter((h) => h.status.state !== "connected");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarTop />
      <div className="px-2 pb-1">
        <Link
          to="/code/new"
          data-testid="code-new"
          className="text-sidebar-foreground hover:bg-sidebar-accent/60 flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Plus className="size-4" />
          <span className="flex-1">New thread</span>
          <Kbd keys="n" />
        </Link>
      </div>
      <nav aria-label="Threads" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {threads === null ? (
          <Spinner className="mx-2 my-2 size-4" />
        ) : sections.length === 0 ? (
          <p className="text-muted-foreground px-2 py-2 text-sm">No threads yet.</p>
        ) : (
          sections.map((section) => (
            <section key={section.key} aria-label={section.label} className="pt-2">
              <h2 className="text-muted-foreground px-2 pb-1 text-xs font-medium">
                {section.label}
              </h2>
              <div className="space-y-px">
                {section.nodes.map((node) => (
                  <Row
                    key={node.row.id}
                    node={node}
                    section={section.key}
                    active={node.row.id === activeId}
                    project={projectName(node.row.projectId)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
        <Archived activeId={activeId} />
      </nav>
      {offline.map((h) => (
        <p
          key={h.id}
          role="status"
          data-testid="code-connection"
          className={cn(
            "border-sidebar-border flex items-center gap-2 border-t px-4 py-1.5 text-xs",
            h.status.state === "reconnecting" ? "text-warning" : "text-muted-foreground",
          )}
        >
          {h.status.state === "connecting" ? (
            <Spinner className="size-3.5 shrink-0" />
          ) : (
            <TriangleAlert className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 truncate" title={h.status.detail}>
            {h.status.state === "reconnecting"
              ? `${h.label} unreachable, retrying…`
              : h.status.state === "connecting"
                ? `Connecting to ${h.label}…`
                : `${h.label}: ${h.status.detail ?? "not ready"}`}
          </span>
        </p>
      ))}
      <div className="border-sidebar-border border-t p-2">
        <Link
          to="/code/settings"
          data-testid="code-settings"
          className="text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground flex h-8 items-center gap-2 rounded-lg px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Settings className="size-4" />
          Settings
        </Link>
      </div>
    </div>
  );
}
