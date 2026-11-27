import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Maximize2,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { botsApi } from "../../lib/bots-api";
import { relativeTime } from "../../lib/bot-groups";
import { codeApi, threadPath, type ThreadSummary } from "../../lib/code/api";
import {
  STATUS_DOT,
  groupOf,
  projectThreads,
  statusLine,
  statusSections,
  type StatusSection,
} from "../../lib/code/list";
import type { ProjectView } from "../../../shared/api/code";
import { useResource } from "../../queries/resource";
import { harnessOf, useCodeStore } from "../../store/code";
import { PullChip, pullState } from "./controls";
import { ThreadView } from "./ThreadView";
import { projectSettingsPath } from "./CodeSettings";

type Tab = "threads" | "context";

const TABS: Array<{ id: Tab; label: string; icon: typeof Rows3 }> = [
  { id: "threads", label: "Threads", icon: Rows3 },
  { id: "context", label: "Context", icon: BookOpen },
];

const ICON_BUTTON =
  "text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function ProjectPanel({
  projectId,
  project,
  threadId,
  onThread,
  onClose,
}: {
  projectId: string;
  project: ProjectView | undefined;
  threadId: string | null;
  onThread(id: string | null): void;
  onClose(): void;
}) {
  const [tab, setTab] = useState<Tab>("threads");
  const showing: Tab = threadId ? "threads" : tab;
  return (
    <>
      <div className="border-border flex h-13 shrink-0 items-center gap-1 border-b px-2">
        <div role="tablist" aria-label="Project panel" className="flex flex-1 items-center gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={showing === id}
              onClick={() => {
                setTab(id);
                if (threadId) onThread(null);
              }}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-lg px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                showing === id
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the panel"
          title="Close the panel"
          className={ICON_BUTTON}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {threadId ? (
          <ThreadInPanel key={threadId} id={threadId} onBack={() => onThread(null)} />
        ) : showing === "threads" ? (
          <ThreadsTab projectId={projectId} onThread={onThread} />
        ) : (
          <ContextTab project={project} />
        )}
      </div>
    </>
  );
}

function ThreadsTab({ projectId, onThread }: { projectId: string; onThread(id: string): void }) {
  const threads = useCodeStore((s) => s.threads);
  const [query, setQuery] = useState("");
  if (threads === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const sections = statusSections(projectThreads(threads, projectId, query));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-6">
      <label className="bg-muted/60 focus-within:ring-ring/50 flex h-8 items-center gap-2 rounded-lg px-2.5 focus-within:ring-2">
        <Search className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search threads"
          aria-label="Search threads"
          maxLength={200}
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {sections.length === 0 && (
        <p className="text-muted-foreground px-1 pt-6 text-center text-sm">
          {query.trim()
            ? "No thread matches."
            : "No threads yet. Ask the project chat to start one."}
        </p>
      )}
      <div className="space-y-3 pt-3">
        {sections.map((section) => (
          <Section
            key={section.key}
            label={section.label}
            count={section.rows.length}
            startOpen={section.key !== "done"}
          >
            {section.rows.map((row) => (
              <ThreadRow key={row.id} row={row} onOpen={() => onThread(row.id)} />
            ))}
          </Section>
        ))}
        {!query.trim() && <Archived projectId={projectId} onThread={onThread} />}
      </div>
    </div>
  );
}

function Section({
  label,
  count,
  startOpen,
  children,
}: {
  label: string;
  count?: number;
  startOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <section aria-label={label}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex h-7 items-center gap-1 px-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {count === undefined ? label : `${label} · ${count}`}
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && <div className="space-y-px">{children}</div>}
    </section>
  );
}

function ThreadRow({ row, onOpen }: { row: ThreadSummary; onOpen(): void }) {
  const group: StatusSection["key"] = row.archived ? "done" : groupOf(row);
  const line = statusLine(row);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-thread={row.id}
      className="hover:bg-muted/60 flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span
        className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", STATUS_DOT[group])}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", row.unread && "font-medium")}>
            {row.title || "Untitled"}
          </span>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {relativeTime(row.updatedAt)}
          </span>
        </span>
        {(line || row.pr) && (
          <span className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
            {row.pr && <PullChip pr={row.pr} />}
            <span className="min-w-0 truncate">{line}</span>
          </span>
        )}
      </span>
    </button>
  );
}

function Archived({ projectId, onThread }: { projectId: string; onThread(id: string): void }) {
  return (
    <Section label="Archived" startOpen={false}>
      <ArchivedRows projectId={projectId} onThread={onThread} />
    </Section>
  );
}

function ArchivedRows({ projectId, onThread }: { projectId: string; onThread(id: string): void }) {
  const { data } = useResource(
    ["code", "threads", "archived"],
    () => codeApi.list("archived"),
    "Could not load archived threads.",
  );
  if (!data) return <Spinner className="mx-2 my-1 size-3.5" />;
  const rows = projectThreads(data, projectId, "");
  if (rows.length === 0) return <p className="text-muted-foreground px-2 py-1 text-xs">None.</p>;
  return rows.map((row) => <ThreadRow key={row.id} row={row} onOpen={() => onThread(row.id)} />);
}

function ThreadInPanel({ id, onBack }: { id: string; onBack(): void }) {
  const threads = useCodeStore((s) => s.threads);
  const harnesses = useCodeStore((s) => s.harnesses);
  const rows = threads ?? [];
  const listed = rows.find((row) => row.id === id);
  const unlisted = useResource(
    ["code", "thread", id],
    async () => (await codeApi.get(id)).thread,
    "Could not open this thread.",
    { enabled: threads !== null && !listed },
  );
  const row = listed ?? unlisted.data ?? undefined;
  const harness = row ? harnessOf(harnesses, row.instanceId) : undefined;
  return (
    <>
      <div className="border-border flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to threads"
          title="Back to threads"
          className={ICON_BUTTON}
        >
          <ArrowLeft className="size-4" />
        </button>
        <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
          {row?.title || "Untitled"}
        </h2>
        <Link
          to={threadPath(id)}
          aria-label="Open the full thread"
          title="Open the full thread, with changes, files and terminal"
          className={ICON_BUTTON}
        >
          <Maximize2 className="size-3.5" />
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        {row && harness ? (
          <ThreadView
            id={id}
            harness={harness}
            rows={rows}
            header={false}
            insert={null}
            branch={row.branch}
            pr={row.pr ?? null}
            composerTop={<PullBar row={row} />}
          />
        ) : unlisted.loadError || (row && !harness) ? (
          <p className="text-muted-foreground p-6 text-center text-sm">
            {unlisted.loadError ?? "This thread's coding agent is not connected to this server."}
          </p>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}
      </div>
    </>
  );
}

function PullBar({ row }: { row: ThreadSummary }) {
  if (!row.pr && !row.branch) return null;
  const branch = row.branch && (
    <span className={cn("text-muted-foreground flex min-w-0 items-center gap-1", monoClass)}>
      <GitBranch className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{row.branch}</span>
    </span>
  );
  const bar =
    "bg-muted/60 flex h-9 items-center gap-2 rounded-xl px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
  if (!row.pr) {
    return (
      <div className={bar} data-testid="project-panel-pr">
        {branch}
      </div>
    );
  }
  return (
    <a
      href={row.pr.url}
      target="_blank"
      rel="noreferrer"
      className={cn(bar, "hover:bg-muted")}
      data-testid="project-panel-pr"
      aria-label={`Open pull request #${row.pr.number} on GitHub`}
    >
      <PullChip pr={row.pr} className="bg-transparent px-0" />
      {branch}
      <span className="text-muted-foreground ml-auto shrink-0">
        {pullState(row.pr.loop)?.label ?? "Open"}
      </span>
      <ExternalLink className="text-muted-foreground size-3 shrink-0" aria-hidden />
    </a>
  );
}

function ContextTab({ project }: { project: ProjectView | undefined }) {
  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const repo = `${project.repo.owner}/${project.repo.name}`;
  const instructions = project.settings.instructions?.trim();
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pt-4 pb-6 text-sm">
      <ContextBlock title="Repository">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a
            href={`https://github.com/${repo}`}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {repo}
          </a>
          <span className={cn("text-muted-foreground flex items-center gap-1 text-xs", monoClass)}>
            <GitBranch className="size-3" aria-hidden />
            {project.baseBranch}
          </span>
        </p>
      </ContextBlock>
      <ContextBlock
        title="Instructions"
        action={
          <Link
            to={projectSettingsPath(project.id)}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            Edit
          </Link>
        }
      >
        {instructions ? (
          <p className="whitespace-pre-wrap">{instructions}</p>
        ) : (
          <p className="text-muted-foreground">
            None yet. Instructions go to the project chat and every thread it starts.
          </p>
        )}
      </ContextBlock>
      {project.chatBotId && <Memories botId={project.chatBotId} />}
    </div>
  );
}

function ContextBlock({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <h3 className="text-muted-foreground flex items-center justify-between text-xs font-medium">
        {title}
        {action}
      </h3>
      {children}
    </section>
  );
}

function Memories({ botId }: { botId: string }) {
  const { data } = useResource(
    ["bots", botId, "memories", "active"],
    () => botsApi.listMemories(botId, false),
    "Could not load the project's memory.",
  );
  const memories = data?.memories ?? null;
  return (
    <ContextBlock title="Memory">
      {memories === null ? (
        <Spinner className="size-3.5" />
      ) : memories.length === 0 ? (
        <p className="text-muted-foreground">Nothing saved yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {memories.map((memory) => (
            <li key={memory.id} className="border-border border-l-2 pl-2.5">
              {memory.text}
            </li>
          ))}
        </ul>
      )}
    </ContextBlock>
  );
}
