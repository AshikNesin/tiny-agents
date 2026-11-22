import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Code2, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, monoClass } from "@groot/ui";
import { isDialogOpen, isEditable, useHotkey } from "@groot/ui/hotkeys";
import { cn } from "@groot/ui/lib/utils";
import { CommandPaletteTrigger } from "@groot/shell/components/CommandPalette";
import { useShellConfig } from "@groot/shell/lib/shell-config";
import { Spinner } from "../../components/ui/spinner";
import { instanceOf, normalizeThreadId, threadPath } from "../../lib/code/api";
import { useThreadCommenting } from "../../lib/code/comments";
import { listOrder, statusSections } from "../../lib/code/list";
import { reviewPath, reviewsApi, useProjects } from "../../lib/code/projects";
import { useLiveChanges } from "../../lib/code/use-live-changes";
import { harnessOf, useCodeStore } from "../../store/code";
import { useUiStore, type CodePane } from "../../store/ui";
import { ChangesPanel } from "./ChangesPanel";
import { CodeSettings } from "./CodeSettings";
import { CodeKeys, Kbd, useCodeCommands, type CodeCommand } from "./keys";
import { NewConversation } from "./NewConversation";
import { PullPanel } from "./PullPanel";
import { PullReview } from "./PullReview";
import { ResizablePane } from "./ResizablePane";
import { ReviewPanel } from "./ReviewPanel";
import { ReviewsScreen } from "./ReviewsScreen";
import { ThreadList } from "./ThreadList";
import { ThreadView, type ThreadHandle } from "./ThreadView";

const PANES: Array<{ id: CodePane; label: string; keys: string }> = [
  { id: "changes", label: "Changes", keys: "1" },
  { id: "pr", label: "Pull request", keys: "2" },
];

function useGitHubSetupResult(reloadProjects: () => void) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const result = new URLSearchParams(search).get("github");
  useEffect(() => {
    if (!result) return;
    if (result === "created") {
      toast.success("GitHub App created. Install it on the repositories Code should reach.");
    } else if (result === "installed") {
      toast.success("GitHub App installed. Its repositories are ready for projects.");
    } else {
      toast.error("GitHub could not finish the App setup. Start it again from Projects.");
    }
    reloadProjects();
    navigate("/code/settings/github", { replace: true });
  }, [result, reloadProjects, navigate]);
}

function focusComposer() {
  document.querySelector<HTMLTextAreaElement>("#code-thread textarea")?.focus();
}

export function LegacyThreadRedirect() {
  const { conversationId } = useParams();
  const { pathname } = useLocation();
  const setPane = useUiStore((s) => s.setCodePane);
  const pane: CodePane | undefined = pathname.endsWith("/pr")
    ? "pr"
    : pathname.endsWith("/changes") || pathname.endsWith("/review")
      ? "changes"
      : undefined;
  useEffect(() => {
    if (pane) setPane(pane);
  }, [pane, setPane]);
  if (!conversationId) return <Navigate to="/code" replace />;
  return (
    <Navigate to={threadPath(normalizeThreadId(decodeURIComponent(conversationId)))} replace />
  );
}

function PaneHeader({
  pane,
  hasPull,
  onPane,
  onClose,
}: {
  pane: CodePane;
  hasPull: boolean;
  onPane(pane: CodePane): void;
  onClose(): void;
}) {
  return (
    <div className="border-border flex h-11 shrink-0 items-center gap-1 border-b px-2">
      <div role="tablist" aria-label="Work pane" className="flex min-w-0 flex-1 items-center gap-1">
        {PANES.filter((entry) => entry.id !== "pr" || hasPull).map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={pane === entry.id}
            onClick={() => onPane(entry.id)}
            data-testid={`code-pane-${entry.id}`}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-lg px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              pane === entry.id
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
            <Kbd keys={entry.keys} />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close the work pane"
        title="Close the work pane"
        className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-7 items-center gap-1.5 rounded-lg px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Kbd keys="\" />
        <X className="size-3.5 lg:hidden" />
      </button>
    </div>
  );
}

export function CodeWorkspace() {
  const { threadId: rawId, section, projectId: settingsProjectId, reviewId } = useParams();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { brand } = useShellConfig();
  const harnessList = useCodeStore((s) => s.harnesses);
  const statuses = useCodeStore((s) => s.statuses);
  const threads = useCodeStore((s) => s.threads);
  const listOpen = useUiStore((s) => s.codeSidebarOpen);
  const toggleUiSidebar = useUiStore((s) => s.toggleSidebar);
  const pane = useUiStore((s) => s.codePane);
  const setPane = useUiStore((s) => s.setCodePane);
  const setHelp = useCodeCommands((s) => s.setHelp);
  const { projects, reload: reloadProjects } = useProjects();
  const [insert, setInsert] = useState<{ text: string; nonce: number } | null>(null);
  const [viewCwd, setViewCwd] = useState<string | null>(null);
  const [handle, setHandle] = useState<ThreadHandle | null>(null);
  const [reviewScope, setReviewScope] = useState<"base" | "harness">("base");
  useGitHubSetupResult(reloadProjects);

  const threadId = rawId ? normalizeThreadId(decodeURIComponent(rawId)) : undefined;
  const inSettings = pathname === "/code/settings" || pathname.startsWith("/code/settings/");
  const composing = pathname === "/code/new";
  const reviewing = pathname === "/code/reviews";

  const harnesses = useMemo(
    () => (harnessList ?? []).map((h) => ({ ...h, status: statuses[h.id] ?? h.status })),
    [harnessList, statuses],
  );
  const listed = useMemo(() => threads?.filter((t) => !t.review) ?? null, [threads]);
  const rows = threads ?? [];
  const row = rows.find((r) => r.id === threadId);
  const harness = threadId ? harnessOf(harnesses, instanceOf(threadId)) : undefined;
  const project = row?.projectId ? projects?.find((p) => p.id === row.projectId) : undefined;
  const cwd = row?.cwd ?? viewCwd;
  const canDiff = Boolean(project) || Boolean(harness?.capabilities.workspace.diffs && cwd);
  const openPane: CodePane | null =
    threadId && pane && (pane === "pr" ? Boolean(project) : canDiff) ? pane : null;

  const changeVersion = useLiveChanges(threadId ?? null, cwd ?? null, openPane === "changes");
  const changesKey =
    changeVersion === null
      ? `${row?.working}:${row?.cursor}`
      : `live:${changeVersion}:${row?.working}`;

  const showPane = useCallback(
    (next: CodePane) => {
      if (threadId) setPane(next);
    },
    [threadId, setPane],
  );
  const commenting = useThreadCommenting(threadId, (text) => {
    setInsert({ text, nonce: Date.now() });
    if (window.matchMedia("(max-width: 1023px)").matches) setPane(null);
  });

  const order = useMemo(() => listOrder(statusSections(listed ?? [])), [listed]);
  const move = useCallback(
    (step: 1 | -1) => {
      if (order.length === 0) return;
      const at = threadId ? order.indexOf(threadId) : -1;
      const next = at < 0 ? (step > 0 ? 0 : order.length - 1) : at + step;
      if (next < 0 || next >= order.length) return;
      navigate(threadPath(order[next]));
    },
    [order, threadId, navigate],
  );
  const nextNeedingYou = useCallback(() => {
    const needs = statusSections(listed ?? []).find((s) => s.key === "needs-you");
    const next = needs?.nodes.find((node) => node.row.id !== threadId);
    if (next) navigate(threadPath(next.row.id));
    else toast("Nothing else needs you.");
  }, [listed, threadId, navigate]);

  const commands = useMemo<CodeCommand[]>(
    () => [
      { id: "next", group: "Go to", keys: "j", label: "Next thread", run: () => move(1) },
      { id: "prev", group: "Go to", keys: "k", label: "Previous thread", run: () => move(-1) },
      {
        id: "needs",
        group: "Go to",
        keys: "u",
        label: "Next thread that needs you",
        run: nextNeedingYou,
      },
      {
        id: "new",
        group: "Go to",
        keys: "n",
        label: "New thread",
        run: () => navigate("/code/new"),
      },
      {
        id: "list",
        group: "Go to",
        keys: "[",
        label: "Show or hide the thread list",
        run: () => toggleUiSidebar("code"),
      },
      {
        id: "compose",
        group: "Thread",
        keys: "c",
        label: "Write to the agent",
        enabled: Boolean(threadId),
        run: focusComposer,
      },
      {
        id: "stop",
        group: "Thread",
        keys: "Escape",
        label: "Stop the agent",
        enabled: Boolean(handle?.working),
        run: () => handle?.stop(),
      },
      {
        id: "archive",
        group: "Thread",
        label: handle?.archived ? "Restore this thread" : "Archive this thread",
        enabled: Boolean(handle),
        run: () => handle?.toggleArchive(),
      },
      {
        id: "changes",
        group: "Pane",
        keys: "1",
        label: "Changes",
        enabled: canDiff,
        run: () => showPane("changes"),
      },
      {
        id: "pr",
        group: "Pane",
        keys: "2",
        label: "Pull request",
        enabled: Boolean(project),
        run: () => showPane("pr"),
      },
      {
        id: "pane",
        group: "Pane",
        keys: "\\",
        label: "Show or hide the work pane",
        enabled: Boolean(threadId),
        run: () => setPane(openPane ? null : (useUiStore.getState().lastCodePane ?? "changes")),
      },
      { id: "keys", group: "Go to", keys: "?", label: "Show the keys", run: () => setHelp(true) },
    ],
    [
      move,
      nextNeedingYou,
      navigate,
      toggleUiSidebar,
      threadId,
      handle,
      canDiff,
      project,
      showPane,
      setPane,
      openPane,
      setHelp,
    ],
  );
  useHotkey(
    "escape",
    () => {
      if (isDialogOpen()) return;
      const active = document.activeElement;
      if (isEditable(active)) return (active as HTMLElement).blur();
      if (handle?.working) handle.stop();
    },
    { inFields: true },
  );

  if (harnessList === null) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (harnessList.length === 0) return <NotConfigured brand={brand} />;
  if (reviewId) return <PullReview reviewId={reviewId} harnesses={harnesses} rows={rows} />;

  const full = Boolean(threadId) || composing || reviewing || inSettings;
  return (
    <div className="flex h-dvh min-h-0">
      <CodeKeys commands={commands} />
      <aside
        id="code-sidebar"
        aria-label="Threads"
        data-state={listOpen ? "open" : "closed"}
        className={cn(
          "bg-sidebar text-sidebar-foreground border-sidebar-border w-full shrink-0 flex-col lg:w-64 lg:border-r-[0.5px]",
          full ? "hidden" : "flex",
          listOpen ? "lg:flex" : "lg:hidden",
        )}
      >
        <ThreadList
          threads={listed}
          harnesses={harnesses}
          projects={projects}
          activeId={threadId}
        />
      </aside>

      <main
        className={cn(
          "relative min-w-0 flex-1 flex-col",
          openPane && "lg:min-w-90",
          full ? (openPane ? "hidden lg:flex" : "flex") : "hidden lg:flex",
        )}
      >
        {inSettings ? (
          <CodeSettings
            section={settingsProjectId ? "projects" : section}
            projectId={settingsProjectId}
            harnesses={harnesses}
            projects={projects}
            onChange={reloadProjects}
          />
        ) : reviewing ? (
          <ReviewsScreen />
        ) : threadId && harness ? (
          <ThreadView
            key={threadId}
            id={threadId}
            harness={harness}
            rows={rows}
            projectName={project?.name}
            pr={row?.pr ?? null}
            insert={insert}
            onShowChanges={openPane === "changes" ? undefined : () => showPane("changes")}
            onCwd={setViewCwd}
            onHandle={setHandle}
          />
        ) : threadId ? (
          <EmptyState
            icon={Code2}
            title="This coding agent is not connected"
            description="The thread belongs to a harness this server no longer runs."
          />
        ) : (
          <NewConversation key={search} rows={rows} harnesses={harnesses} projects={projects} />
        )}
      </main>

      {openPane && threadId && (
        <ResizablePane>
          <PaneHeader
            pane={openPane}
            hasPull={Boolean(project)}
            onPane={showPane}
            onClose={() => setPane(null)}
          />
          <div className="min-h-0 flex-1" data-testid="code-pane">
            {openPane === "pr" ? (
              <PullPanel
                threadId={threadId}
                refreshKey={`${row?.working}:${row?.cursor}:${row?.pr?.loop}`}
                onAttach={(text) => {
                  setInsert({ text, nonce: Date.now() });
                  if (window.matchMedia("(max-width: 1023px)").matches) setPane(null);
                }}
                onReview={async (url) => {
                  const review = await reviewsApi.open(url);
                  navigate(reviewPath(review.id));
                }}
              />
            ) : project && reviewScope === "base" ? (
              <ReviewPanel
                threadId={threadId}
                baseBranch={project.baseBranch}
                refreshKey={changesKey}
                editable
                commenting={commenting}
                onOtherScopes={
                  harness?.capabilities.workspace.diffs
                    ? () => setReviewScope("harness")
                    : undefined
                }
              />
            ) : harness && cwd ? (
              <ChangesPanel
                instanceId={harness.id}
                cwd={cwd}
                refreshKey={changesKey}
                commenting={commenting}
              />
            ) : null}
          </div>
        </ResizablePane>
      )}
    </div>
  );
}

function NotConfigured({ brand }: { brand: { to: string; label: string } }) {
  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <header className="border-border bg-background flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Link
          to={brand.to}
          className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-8 min-w-0 items-center gap-1.5 rounded-xl px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4 shrink-0" />
          <span className="truncate">Back to {brand.label}</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <CommandPaletteTrigger />
        </div>
      </header>
      <div className="mx-auto max-w-xl p-6">
        <EmptyState
          icon={Code2}
          title="No coding agent is connected"
          description={
            <>
              Set <code className={monoClass}>SHELLEY_URL</code> to your Shelley server and restart,
              or add the Claude plan in{" "}
              <Link to="/settings/models" className="text-foreground underline underline-offset-2">
                Settings → Models
              </Link>
              . See docs/features/code.md.
            </>
          }
        />
      </div>
    </div>
  );
}
