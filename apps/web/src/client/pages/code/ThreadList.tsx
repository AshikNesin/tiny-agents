import { useMemo, useState, type ReactElement } from "react";
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
import { STATUS_DOT, starterOf, statusSections, type StatusSection } from "../../lib/code/list";
import type { ProjectView } from "../../../shared/api/code";
import { useResource } from "../../queries/resource";
import { PullChip, useArchive } from "./controls";
import { Kbd } from "../../components/keys";
import { ReviewList } from "./ReviewList";

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
  children: ReactElement;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const archive = useArchive();
  const can = harness?.capabilities.threads;
  const title = row.title || "Untitled";
  const pr = row.pr;
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
      <ContextMenuTrigger render={children} />
      <ContextMenuContent>
        {pr && (
          <ContextMenuItem
            render={(linkProps) => (
              <a {...linkProps} href={pr.url} target="_blank" rel="noreferrer">
                {linkProps.children}
              </a>
            )}
          >
            <GitPullRequest />
            Open PR #{pr.number}
          </ContextMenuItem>
        )}
        {can?.archive && (
          <ContextMenuItem
            onSelect={() => void archive(row, !row.archived, { leave: active && !row.archived })}
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
  project,
  harness,
}: {
  row: ThreadSummary;
  section: StatusSection["key"];
  active: boolean;
  project?: string;
  harness?: HarnessInfo;
}) {
  const meta = metaOf(row);
  const starter = starterOf(row);
  return (
    <ThreadMenu row={row} active={active} harness={harness}>
      <Link
        to={threadPath(row.id)}
        aria-current={active ? "page" : undefined}
        data-testid="code-thread-row"
        data-thread={row.id}
        data-status={section}
        title={starter ? `Started by ${starter}` : undefined}
        className={cn(
          "group flex h-8 items-center gap-2 rounded-lg px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent/60",
        )}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[section])} aria-hidden />
        <span className={cn("min-w-0 flex-1 truncate", row.unread && "font-medium")}>
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
  const archived = useResource(
    ["code", "threads", "archived"],
    () => codeApi.list("archived"),
    "Could not load archived threads.",
  );
  const data =
    archived.status === "ready"
      ? archived.data
      : archived.status === "failed"
        ? archived.last
        : undefined;
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

function ProjectChats({ projects }: { projects: ProjectView[] }) {
  if (projects.length === 0) return null;
  return (
    <section aria-label="Project chats" className="space-y-px pt-2">
      {projects.map((project) => {
        return (
          <Link
            key={project.id}
            to={projectChatPath(project.id)}
            data-testid="code-project-chat"
            className="text-sidebar-foreground hover:bg-sidebar-accent/60 flex h-8 items-center gap-2 rounded-lg px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <MessagesSquare className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {projects.length > 1 ? `${project.name} chat` : "Project chat"}
            </span>
          </Link>
        );
      })}
    </section>
  );
}

export function ThreadList({
  threads,
  harnesses,
  projects,
  activeId,
  onNew,
  addingReview,
  onAddingReview,
}: {
  threads: ThreadSummary[] | null;
  harnesses: HarnessInfo[];
  projects?: ProjectView[] | null;
  activeId?: string;
  onNew(): void;
  addingReview: boolean;
  onAddingReview(open: boolean): void;
}) {
  const sections = useMemo(() => statusSections(threads ?? []), [threads]);
  const projectName = (id?: string | null) =>
    (projects?.length ?? 0) > 1 ? projects?.find((p) => p.id === id)?.name : undefined;
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
        <ProjectChats projects={projects ?? []} />
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
                {section.rows.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    section={section.key}
                    active={row.id === activeId}
                    project={projectName(row.projectId)}
                    harness={harnesses.find((h) => h.id === row.instanceId)}
                  />
                ))}
              </div>
            </section>
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
          to="/settings/projects"
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
