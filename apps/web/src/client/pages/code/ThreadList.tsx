import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  CircleAlert,
  GitPullRequest,
  MessagesSquare,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@groot/ui/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@groot/ui/context-menu";
import { useConfirm } from "@groot/ui/primitives";
import { errorMessage } from "../../lib/errors";
import { Spinner } from "../../components/ui/spinner";
import { SidebarTop } from "../../components/shell/ModeSwitch";
import {
  codeApi,
  projectChatPath,
  threadPath,
  type HarnessInfo,
  type ThreadSummary,
} from "../../lib/code/api";
import { groupOf, projectGroups, type ProjectGroup, type StatusSection } from "../../lib/code/list";
import { useUiStore } from "../../store/ui";
import type { ProjectView } from "../../../shared/api/code";
import { useResource } from "../../queries/resource";
import { PullChip, useArchive } from "./controls";
import { Kbd } from "../../components/keys";
import { ReviewList } from "./ReviewList";

const DOT: Record<StatusSection["key"], string> = {
  "needs-you": "bg-warning",
  working: "bg-info animate-pulse motion-reduce:animate-none",
  review: "bg-success",
  done: "bg-muted-foreground/40",
};

function metaOf(row: ThreadSummary): string {
  if (row.status?.reason === "finished") return "";
  if (row.status?.reason) return row.status.reason;
  if (row.queuedCount) return `${row.queuedCount} queued`;
  return row.offline ? "offline" : "";
}

function ThreadMenu({
  row,
  active,
  harness,
  children,
}: {
  row: ThreadSummary;
  active: boolean;
  harness?: HarnessInfo;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const archive = useArchive();
  const can = harness?.capabilities.threads;
  const title = row.title || "Untitled";
  const remove = async () => {
    const yes = await confirm({
      title: `Delete “${title}”?`,
      description: "The thread and its transcript are deleted for good. Its branch stays.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!yes) return;
    try {
      await codeApi.remove(row.id);
      if (active) navigate("/code");
      toast.success(`Deleted “${title}”`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete it."));
    }
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {row.pr && (
          <ContextMenuItem asChild>
            <a href={row.pr.url} target="_blank" rel="noreferrer">
              <GitPullRequest />
              Open PR #{row.pr.number}
            </a>
          </ContextMenuItem>
        )}
        {can?.archive && (
          <ContextMenuItem
            onSelect={() =>
              void archive(row, !row.archived, {
                leave: active && !row.archived,
              })
            }
          >
            {row.archived ? <ArchiveRestore /> : <Archive />}
            {row.archived ? "Unarchive" : "Archive"}
          </ContextMenuItem>
        )}
        {can?.delete && (
          <>
            {(row.pr || can.archive) && <ContextMenuSeparator />}
            <ContextMenuItem variant="destructive" onSelect={() => void remove()}>
              <Trash2 />
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function Row({
  row,
  section,
  active,
  harness,
}: {
  row: ThreadSummary;
  section: StatusSection["key"];
  active: boolean;
  harness?: HarnessInfo;
}) {
  const meta = metaOf(row);
  return (
    <ThreadMenu row={row} active={active} harness={harness}>
      <Link
        to={threadPath(row.id)}
        aria-current={active ? "page" : undefined}
        data-testid="code-thread-row"
        data-thread={row.id}
        data-status={section}
        className={cn(
          "group flex h-8 items-center gap-2 rounded-lg px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent/60",
        )}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", DOT[section])} aria-hidden />
        <span className={cn("min-w-0 flex-1 truncate", row.unread && "font-medium")}>
          {row.title || "Untitled"}
        </span>
        {meta && <span className="text-muted-foreground shrink-0 text-xs">{meta}</span>}
        {row.pr && <PullChip pr={row.pr} />}
      </Link>
    </ThreadMenu>
  );
}

function Archived({ activeId, harnesses }: { activeId?: string; harnesses: HarnessInfo[] }) {
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
      {open && <ArchivedRows activeId={activeId} harnesses={harnesses} />}
    </section>
  );
}

function ArchivedRows({ activeId, harnesses }: { activeId?: string; harnesses: HarnessInfo[] }) {
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
          row={row}
          section="done"
          active={row.id === activeId}
          harness={harnesses.find((h) => h.id === row.instanceId)}
        />
      ))}
    </div>
  );
}

const OTHER = "other";

function ProjectGroupView({
  group,
  activeId,
  activeChat,
  harnesses,
}: {
  group: ProjectGroup<ProjectView>;
  activeId?: string;
  activeChat?: string;
  harnesses: HarnessInfo[];
}) {
  const { project, rows } = group;
  const key = project?.id ?? OTHER;
  const folded = useUiStore((s) => s.codeFolded.includes(key));
  const toggle = useUiStore((s) => s.toggleCodeFolded);
  const name = project?.name ?? "Other";
  const active = Boolean(project) && project?.id === activeChat;
  const waiting = rows.filter((row) => groupOf(row) === "needs-you").length;
  return (
    <section aria-label={name} data-testid="code-project" className="pt-2">
      <div
        className={cn(
          "group/project flex h-8 items-center gap-1 rounded-lg pr-2 pl-0.5",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent/60",
        )}
      >
        <button
          type="button"
          onClick={() => toggle(key)}
          aria-expanded={!folded}
          aria-label={folded ? `Show ${name} threads` : `Hide ${name} threads`}
          className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", !folded && "rotate-90")} />
        </button>
        {project ? (
          <Link
            to={projectChatPath(project.id)}
            aria-current={active ? "page" : undefined}
            data-testid="code-project-chat"
            aria-label={`${name} chat`}
            title={`Chat about ${name}`}
            className="flex h-full min-w-0 flex-1 items-center gap-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="min-w-0 flex-1 truncate">{name}</span>
            {folded && waiting > 0 && (
              <span className="bg-warning size-1.5 shrink-0 rounded-full" aria-hidden />
            )}
            <MessagesSquare
              className={cn(
                "size-3.5 shrink-0",
                active ? "opacity-100" : "opacity-50 group-hover/project:opacity-100",
              )}
              aria-hidden
            />
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        )}
      </div>
      {!folded && (
        <div className="space-y-px">
          {rows.length === 0 ? (
            <p className="text-muted-foreground py-1 pl-7.5 text-xs">No threads yet.</p>
          ) : (
            rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                section={groupOf(row)}
                active={row.id === activeId}
                harness={harnesses.find((h) => h.id === row.instanceId)}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

export function ThreadList({
  threads,
  harnesses,
  projects,
  activeId,
  activeChat,
  onNew,
  addingReview,
  onAddingReview,
}: {
  threads: ThreadSummary[] | null;
  harnesses: HarnessInfo[];
  projects?: ProjectView[] | null;
  activeId?: string;
  activeChat?: string;
  onNew(): void;
  addingReview: boolean;
  onAddingReview(open: boolean): void;
}) {
  const groups = useMemo(() => projectGroups(threads ?? [], projects ?? []), [threads, projects]);
  const offline = harnesses.filter((h) => h.status.state !== "connected");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarTop />
      <div className="px-2 pb-1">
        <button
          type="button"
          onClick={onNew}
          data-testid="code-new"
          className="text-sidebar-foreground hover:bg-sidebar-accent/60 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Plus className="size-4" />
          <span className="flex-1 text-left">New thread</span>
          <Kbd keys="n" />
        </button>
      </div>
      <nav aria-label="Threads" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {threads === null ? (
          <Spinner className="mx-2 my-2 size-4" />
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground px-2 py-2 text-sm">No threads yet.</p>
        ) : (
          groups.map((group) => (
            <ProjectGroupView
              key={group.project?.id ?? OTHER}
              group={group}
              activeId={activeId}
              activeChat={activeChat}
              harnesses={harnesses}
            />
          ))
        )}
        <ReviewList activeId={activeId} adding={addingReview} onAdding={onAddingReview} />
        <Archived activeId={activeId} harnesses={harnesses} />
      </nav>
      {offline.map((h) => (
        <p
          key={h.id}
          role="status"
          data-testid="code-connection"
          className="border-sidebar-border text-muted-foreground flex items-center gap-2 border-t px-4 py-1.5 text-xs"
        >
          {h.status.state === "connecting" ? (
            <Spinner className="size-3.5 shrink-0" />
          ) : (
            <CircleAlert className="size-3.5 shrink-0 opacity-70" />
          )}
          <span className="min-w-0 truncate" title={h.status.detail}>
            {h.status.state === "connecting"
              ? `Connecting to ${h.label}…`
              : h.status.state === "reconnecting"
                ? `${h.label} is offline, retrying…`
                : `${h.label} is not connected`}
          </span>
        </p>
      ))}
      <div className="border-sidebar-border flex items-center gap-1 border-t p-2">
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
