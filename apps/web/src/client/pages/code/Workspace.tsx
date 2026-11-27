import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Code2, Maximize2, Minimize2, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, monoClass } from "@groot/ui";
import { isDialogOpen, isEditable, useHotkey } from "@groot/ui/hotkeys";
import { cn } from "@groot/ui/lib/utils";
import { useConfirm } from "@groot/ui/primitives";
import { CommandPaletteTrigger } from "@groot/shell/components/CommandPalette";
import { useShellConfig } from "@groot/shell/lib/shell-config";
import { Spinner } from "../../components/ui/spinner";
import { codeApi, threadPath } from "../../lib/code/api";
import { useThreadCommenting } from "../../lib/code/comments";
import { listOrder, statusSections } from "../../lib/code/list";
import { projectsApi, reviewPath, reviewsApi, useProjects } from "../../lib/code/projects";
import { usePullActions } from "../../lib/code/use-thread-pulls";
import { errorMessage } from "../../lib/errors";
import type { WorkflowName } from "../../../shared/code-status";
import { useLiveChanges } from "../../lib/code/use-live-changes";
import { useResource } from "../../queries/resource";
import { harnessOf, useCodeStore } from "../../store/code";
import { useUiStore, type CodePane } from "../../store/ui";
import { PageKeys, Kbd, useKeyCommands, type KeyCommand } from "../../components/keys";
import { FilesPane, type FilesFocus } from "./FilesPane";
import { NewThread } from "./NewThread";
import { TerminalPane } from "./TerminalPane";
import { useCommandPaletteStore } from "@groot/shell/store/command-palette";
import { PullPanel } from "./PullPanel";
import { useArchive } from "./controls";
import { NextSteps } from "./NextSteps";
import { PullReview } from "./PullReview";
import { ResizablePane } from "./ResizablePane";
import { ReviewPanel } from "./ReviewPanel";
import { ThreadList } from "./ThreadList";
import { ThreadView } from "./ThreadView";
import { ProjectChat } from "./ProjectChat";

const PANES: Array<{ id: CodePane; label: string; keys: string }> = [
  { id: "changes", label: "Changes", keys: "1" },
  { id: "pr", label: "Pull request", keys: "2" },
  { id: "files", label: "Files", keys: "3" },
  { id: "terminal", label: "Terminal", keys: "4" },
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
    navigate("/settings/github", { replace: true });
  }, [result, reloadProjects, navigate]);
}

function focusComposer() {
  document.querySelector<HTMLTextAreaElement>("#code-thread textarea")?.focus();
}

function PaneHeader({
  pane,
  hasPull,
  wide,
  onPane,
  onWide,
  onClose,
}: {
  pane: CodePane;
  hasPull: boolean;
  wide: boolean;
  onPane(pane: CodePane): void;
  onWide(): void;
  onClose(): void;
}) {
  const WideIcon = wide ? Minimize2 : Maximize2;
  return (
    <div className="border-border flex h-11 shrink-0 items-center gap-1 border-b px-2">
      <div
        role="tablist"
        aria-label="Work pane"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {PANES.filter((entry) => entry.id !== "pr" || hasPull).map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={pane === entry.id}
            onClick={() => onPane(entry.id)}
            data-testid={`code-pane-${entry.id}`}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              pane === entry.id
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
            <Kbd keys={entry.keys} className="max-sm:hidden" />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onWide}
        aria-label={wide ? "Restore the work pane" : "Widen the work pane"}
        title={wide ? "Restore the work pane" : "Widen the work pane over the thread"}
        aria-pressed={wide}
        className="text-muted-foreground hover:bg-muted hover:text-foreground hidden h-7 items-center gap-1.5 rounded-lg px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 lg:flex"
      >
        <WideIcon className="size-3.5" />
        <Kbd keys="z" />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close the work pane"
        title="Close the work pane"
        className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-7 items-center gap-1.5 rounded-lg px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Kbd keys="\" className="max-sm:hidden" />
        <X className="size-3.5 lg:hidden" />
      </button>
    </div>
  );
}

export function CodeWorkspace() {
  const { threadId: rawId, reviewId, chatProjectId } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { brand } = useShellConfig();
  const harnessList = useCodeStore((s) => s.harnesses);
  const statuses = useCodeStore((s) => s.statuses);
  const threads = useCodeStore((s) => s.threads);
  const listOpen = useUiStore((s) => s.codeSidebarOpen);
  const toggleUiSidebar = useUiStore((s) => s.toggleSidebar);
  const pane = useUiStore((s) => s.codePane);
  const setPane = useUiStore((s) => s.setCodePane);
  const paneWide = useUiStore((s) => s.codePaneWide);
  const toggleWide = useUiStore((s) => s.toggleCodePaneWide);
  const setHelp = useKeyCommands((s) => s.setHelp);
  const { projects, reload: reloadProjects } = useProjects();
  const [insert, setInsert] = useState<{ text: string; nonce: number } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [addingReview, setAddingReview] = useState(false);
  useGitHubSetupResult(reloadProjects);

  const threadId = rawId ? decodeURIComponent(rawId) : undefined;
  const composing = pathname === "/code/new";

  const harnesses = useMemo(
    () => (harnessList ?? []).map((h) => ({ ...h, status: statuses[h.id] ?? h.status })),
    [harnessList, statuses],
  );
  const listed = useMemo(() => threads?.filter((t) => !t.review) ?? null, [threads]);
  const rows = threads ?? [];
  const listedRow = rows.find((r) => r.id === threadId);
  const unlisted = useResource(
    ["code", "thread", threadId],
    async () => (await codeApi.get(threadId!)).thread,
    "Could not open this thread.",
    { enabled: Boolean(threadId) && threads !== null && !listedRow },
  );
  const row = listedRow ?? unlisted.data ?? undefined;
  const harness = row ? harnessOf(harnesses, row.instanceId) : undefined;
  const project = row?.projectId ? projects?.find((p) => p.id === row.projectId) : undefined;
  const openPane: CodePane | null = threadId && pane && project ? pane : null;
  const wide = Boolean(openPane) && paneWide;

  const changeVersion = useLiveChanges(
    threadId ?? null,
    openPane === "changes" || openPane === "files",
  );
  const changesKey =
    changeVersion === null
      ? `${row?.working}:${row?.cursor}`
      : `live:${changeVersion}:${row?.working}`;

  useEffect(() => {
    if (threadId && window.matchMedia("(max-width: 1023px)").matches) setPane(null);
  }, [threadId, setPane]);

  const showPane = useCallback(
    (next: CodePane) => {
      if (threadId) setPane(next);
    },
    [threadId, setPane],
  );
  const [filesFocus, setFilesFocus] = useState<FilesFocus | null>(null);
  const clearFilesFocus = useCallback(() => setFilesFocus(null), []);
  const focusFiles = useCallback(
    (which: "name" | "text") => {
      if (!threadId) return;
      setPane("files");
      setFilesFocus({ which, at: Date.now() });
    },
    [threadId, setPane],
  );
  const confirm = useConfirm();
  const prNumber = row?.pr?.number;
  const runWorkflow = useCallback(
    (name: WorkflowName) => {
      if (!threadId) return;
      void projectsApi
        .runWorkflow(threadId, name)
        .then((result) =>
          result.started
            ? toast.success("Started. The agent works in this thread.")
            : toast.message(result.reason ?? "Nothing to do."),
        )
        .catch((error: unknown) => toast.error(errorMessage(error, "Could not start it.")));
    },
    [threadId],
  );
  const { act } = usePullActions(threadId ?? "");
  const publish = useCallback(() => {
    if (!threadId) return;
    setPane("pr");
    void act("publish", () => projectsApi.publish(threadId, { commit: true })).then(
      (done) => done && toast.success("Pushed to GitHub"),
    );
  }, [threadId, setPane, act]);
  const pushBase = useCallback(() => {
    if (!threadId) return;
    setPane("pr");
    void act("push", () => projectsApi.pushBase(threadId)).then(
      (done) => done && toast.success("Pushed to GitHub"),
    );
  }, [threadId, setPane, act]);
  const archiveThread = useArchive();
  const archive = useCallback(() => {
    if (!threadId) return;
    void archiveThread({ id: threadId, title: row?.title ?? "" }, true, { leave: true });
  }, [threadId, row?.title, archiveThread]);
  const merge = useCallback(() => {
    if (!threadId || !prNumber) return;
    setPane("pr");
    void confirm({
      title: `Merge pull request #${prNumber}?`,
      description: "It merges on GitHub with the repository's default method.",
      confirmLabel: "Merge",
    }).then((yes) => {
      if (!yes) return;
      void act("merge", () => projectsApi.merge(threadId)).then(
        (done) => done && toast.success(`Merged #${prNumber}`),
      );
    });
  }, [threadId, prNumber, setPane, confirm, act]);
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
    const next = needs?.rows.find((row) => row.id !== threadId);
    if (next) navigate(threadPath(next.id));
    else toast("Nothing else needs you.");
  }, [listed, threadId, navigate]);

  const commands = useMemo<KeyCommand[]>(
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
        id: "review",
        group: "Go to",
        keys: "v",
        label: "Review a pull request",
        run: () => {
          if (!listOpen) toggleUiSidebar("code");
          setAddingReview(true);
        },
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
        id: "changes",
        group: "Pane",
        keys: "1",
        label: "Changes",
        enabled: Boolean(project),
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
        id: "fix-ci",
        group: "Thread",
        keys: "f",
        label: "Fix CI: the agent fixes the failing checks",
        enabled: Boolean(row?.pr),
        run: () => runWorkflow("fix_ci"),
      },
      {
        id: "address-comments",
        group: "Thread",
        keys: "a",
        label: "Address comments: the agent answers the review",
        enabled: Boolean(row?.pr),
        run: () => runWorkflow("address_comments"),
      },
      {
        id: "publish",
        group: "Thread",
        keys: "P",
        label: row?.pr ? "Push new commits to the pull request" : "Publish a pull request",
        enabled: Boolean(project),
        run: publish,
      },
      {
        id: "merge",
        group: "Thread",
        keys: "M",
        label: "Merge the pull request",
        enabled: Boolean(row?.pr),
        run: merge,
      },
      {
        id: "files",
        group: "Pane",
        keys: "3",
        label: "Files",
        enabled: Boolean(project),
        run: () => showPane("files"),
      },
      {
        id: "open-file",
        group: "Pane",
        keys: "p",
        label: "Open a file by name",
        enabled: Boolean(project),
        run: () => focusFiles("name"),
      },
      {
        id: "search-files",
        group: "Pane",
        keys: "s",
        label: "Search in files",
        enabled: Boolean(project),
        run: () => focusFiles("text"),
      },
      {
        id: "terminal",
        group: "Pane",
        keys: "4",
        label: "Terminal",
        enabled: Boolean(project),
        run: () => showPane("terminal"),
      },
      {
        id: "terminal-toggle",
        group: "Pane",
        keys: "`",
        label: "Show or hide the terminal",
        enabled: Boolean(project),
        run: () => setPane(openPane === "terminal" ? null : "terminal"),
      },
      {
        id: "wide",
        group: "Pane",
        keys: "z",
        label: "Widen the work pane over the thread, or put it back",
        enabled: Boolean(openPane),
        run: toggleWide,
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
      {
        id: "commands",
        group: "Go to",
        keys: ":",
        label: "Open the command palette",
        run: () => useCommandPaletteStore.getState().setOpen(true),
      },
    ],
    [
      move,
      nextNeedingYou,
      navigate,
      toggleUiSidebar,
      listOpen,
      threadId,
      project,
      showPane,
      setPane,
      openPane,
      toggleWide,
      setHelp,
      focusFiles,
      row?.pr,
      runWorkflow,
      publish,
      merge,
    ],
  );
  useHotkey(
    "escape",
    () => {
      if (isDialogOpen()) return;
      const active = document.activeElement;
      if (isEditable(active)) (active as HTMLElement).blur();
    },
    { inFields: true, enabled: !threadId },
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

  const full = Boolean(threadId) || Boolean(chatProjectId) || composing;
  return (
    <div className="flex h-dvh min-h-0">
      <PageKeys commands={commands} />
      <aside
        id="code-sidebar"
        aria-label="Threads"
        hidden={wide || undefined}
        data-state={listOpen ? "open" : "closed"}
        className={cn(
          "sidebar-surface text-sidebar-foreground border-sidebar-border w-full shrink-0 flex-col lg:w-68 lg:border-r-[0.5px]",
          full ? "hidden" : "flex",
          listOpen ? "lg:flex" : "lg:hidden",
        )}
      >
        <ThreadList
          threads={listed}
          harnesses={harnesses}
          projects={projects}
          activeId={threadId}
          activeChat={chatProjectId}
          onNew={() => navigate("/code/new")}
          addingReview={addingReview}
          onAddingReview={setAddingReview}
        />
      </aside>

      <main
        hidden={wide || undefined}
        className={cn(
          "relative min-w-0 flex-1 flex-col",
          openPane && "lg:min-w-90",
          full ? (openPane ? "hidden lg:flex" : "flex") : "hidden lg:flex",
        )}
      >
        {chatProjectId ? (
          <ProjectChat projectId={chatProjectId} />
        ) : threadId && harness && row ? (
          <ThreadView
            key={`${threadId}:${epoch}`}
            id={threadId}
            harness={harness}
            rows={rows}
            onReplaced={() => setEpoch((was) => was + 1)}
            projectName={project?.name}
            branch={row.branch}
            pr={row.pr ?? null}
            insert={insert}
            onShowChanges={openPane === "changes" ? undefined : () => showPane("changes")}
            commands
            nextSteps={
              project ? (
                <NextSteps
                  threadId={threadId}
                  refreshKey={`${row?.working}:${row?.cursor}:${row?.pr?.loop}`}
                  onStep={(step) => {
                    if (step === "create-pr" || step === "push") publish();
                    else if (step === "merge") merge();
                    else if (step === "archive") archive();
                    else if (step === "push-main") pushBase();
                    else if (step === "review") showPane("changes");
                    else showPane("pr");
                  }}
                />
              ) : undefined
            }
          />
        ) : threadId && (unlisted.loadError || (row && !harness)) ? (
          <EmptyState
            icon={Code2}
            title="This thread cannot be opened"
            description={unlisted.loadError ?? "Its coding agent is not connected to this server."}
          />
        ) : threadId ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <NewThread focused={composing} projects={projects} harnesses={harnesses} />
        )}
      </main>

      {openPane && threadId && (
        <ResizablePane wide={wide}>
          <PaneHeader
            pane={openPane}
            hasPull={Boolean(project)}
            wide={wide}
            onWide={toggleWide}
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
                onArchive={archive}
              />
            ) : openPane === "files" ? (
              <FilesPane
                threadId={threadId}
                refreshKey={changesKey}
                focus={filesFocus}
                onFocused={clearFilesFocus}
                editor={harness && row?.cwd ? { harness, folder: row.cwd } : undefined}
              />
            ) : openPane === "terminal" && project ? (
              <TerminalPane threadId={threadId} place={row?.cwd ?? project.name} />
            ) : project ? (
              <ReviewPanel
                threadId={threadId}
                baseBranch={project.baseBranch}
                refreshKey={changesKey}
                editable
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
