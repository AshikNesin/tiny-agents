/**
 * Code (issue #143, ADR 0011): one workspace for the owner's coding agents
 * ("harnesses": Shelley, Claude Code). tiny-agents runs no agent loop; each
 * harness is driven through its adapter on the server — every thread and
 * subagent, live transcripts, steering, approvals and the diff of what
 * changed — and the page shows only what a thread's harness can do.
 *
 * Layout, after t3code: a sidebar of threads grouped by project (with the
 * way back to the app, ⌘K, Archived and Settings) | thread | changes on wide
 * screens (the list steps aside for Changes until 2xl, and Hide sidebar or ⌘B
 * folds it away, remembered in this browser); one column at a time
 * on phones (`/code` → `/code/new` or `/code/:id` → `/code/:id/changes`).
 * `/code/:id/review` shows the same Changes and Pull request at full width
 * (each side pane's Open as a page goes there).
 * Projects and GitHub are settings pages of their own (`/code/settings`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ArrowLeft, Code2, PanelLeftClose, PanelLeftOpen, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { CommandPaletteTrigger } from "@groot/shell/components/CommandPalette";
import { useShellConfig } from "@groot/shell/lib/shell-config";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import {
  codeApi,
  instanceOf,
  normalizeThreadId,
  threadPath,
  type HarnessInfo,
} from "../../lib/code/api";
import { useProjects } from "../../lib/code/projects";
import { harnessOf, useCodeStore } from "../../store/code";
import { ChangesPanel } from "./ChangesPanel";
import { CodeSettings } from "./CodeSettings";
import { useLiveChanges } from "../../lib/code/use-live-changes";
import { useThreadCommenting } from "../../lib/code/comments";
import { PullPanel } from "./PullPanel";
import { ReviewPanel } from "./ReviewPanel";
import { ReviewPage, type ReviewTab } from "./ReviewPage";
import { ReviewSidebar, type SideTab } from "./ReviewSidebar";

const SIDE_TAB_KEY = "tiny-agents:code-side-tab";

function readSideTab(): SideTab {
  try {
    return window.localStorage.getItem(SIDE_TAB_KEY) === "pr" ? "pr" : "source";
  } catch {
    return "source";
  }
}
import { ConversationList } from "./ConversationList";
import { ConversationView } from "./ConversationView";
import { NewConversation } from "./NewConversation";
import { ThreadsScreen } from "./ThreadsScreen";

const SIDEBAR_KEY = "tiny-agents:code-sidebar";

function readSidebar(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
}

/** The thread list on wide screens (phones show it as its own screen), remembered here. */
function useSidebar(): [boolean, () => void] {
  const [open, setOpen] = useState(readSidebar);
  const toggle = useCallback(() => setOpen((shown) => !shown), []);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, open ? "open" : "closed");
    } catch {
      // not remembered in private mode
    }
  }, [open]);
  return [open, toggle];
}

/** Back from GitHub's App setup: say how it went and open GitHub settings for the next step. */
function useGitHubSetupResult(result: string | null, reloadProjects: () => void) {
  const navigate = useNavigate();
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

/** ⌘B folds the sidebar, ⌘. stops the agent, ⌘⇧D toggles Changes. */
function useCodeShortcuts(
  threadId: string | undefined,
  toggleChanges: () => void,
  toggleSidebar: () => void,
) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (!event.shiftKey && !event.altKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (!threadId) return;
      if (event.key === ".") {
        event.preventDefault();
        codeApi
          .interrupt(threadId)
          .catch((error: unknown) => toast.error(errorMessage(error, "Could not stop it.")));
      } else if (event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        toggleChanges();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threadId, toggleChanges, toggleSidebar]);
}

function SlugRedirect({ slug }: { slug: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    codeApi
      .byTitle(slug)
      .then((t) => navigate(threadPath(t.id), { replace: true }))
      .catch(() => {
        toast.error(`No thread “${slug}”.`);
        navigate("/code", { replace: true });
      });
  }, [slug, navigate]);
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

export function CodePage() {
  const { conversationId: rawId, slug, section, projectId: settingsProjectId } = useParams();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { brand } = useShellConfig();
  const harnessList = useCodeStore((s) => s.harnesses);
  const statuses = useCodeStore((s) => s.statuses);
  const threads = useCodeStore((s) => s.threads);
  const [insert, setInsert] = useState<{ text: string; nonce: number } | null>(null);
  const [sidebarOpen, toggleSidebar] = useSidebar();
  // The open thread's directory, for Changes even when it is not in the
  // active list (archived, or not in the list yet).
  const [viewCwd, setViewCwd] = useState<string | null>(null);
  const threadId = rawId ? normalizeThreadId(decodeURIComponent(rawId)) : undefined;
  const changesOpen = Boolean(threadId) && pathname.endsWith("/changes");
  const prOpen = Boolean(threadId) && pathname.endsWith("/pr");
  const reviewOpen = Boolean(threadId) && pathname.endsWith("/review");
  const { projects, reload: reloadProjects } = useProjects();
  const inSettings = pathname === "/code/settings" || pathname.startsWith("/code/settings/");
  const [searchParams] = useSearchParams();
  useGitHubSetupResult(searchParams.get("github"), reloadProjects);
  const reviewTab: ReviewTab = searchParams.get("tab") === "pr" ? "pr" : "changes";
  // A project thread's Changes default to everything since its base branch.
  const [reviewScope, setReviewScope] = useState<"base" | "harness">("base");
  // `/code/new` is the new-thread screen on phones (`/code` is the list there).
  const composing = pathname === "/code/new";
  // `/code/threads`: every thread (or one project's) at full width, by status.
  const browsing = pathname === "/code/threads";
  const rows = useMemo(() => threads ?? [], [threads]);
  const row = rows.find((r) => r.id === threadId);
  const cwd = row?.cwd ?? viewCwd;
  // While Changes is open the server pushes a version each time the files move;
  // where it cannot watch them, the panels re-read on transcript activity.
  const changeVersion = useLiveChanges(
    threadId ?? null,
    cwd ?? null,
    changesOpen || (reviewOpen && reviewTab === "changes"),
  );
  const changesKey =
    changeVersion === null
      ? `${row?.working}:${row?.cursor}`
      : `live:${changeVersion}:${row?.working}`;
  // Live connection state over the static description.
  const harnesses = useMemo(
    () => (harnessList ?? []).map((h) => ({ ...h, status: statuses[h.id] ?? h.status })),
    [harnessList, statuses],
  );
  const harness = threadId ? harnessOf(harnesses, instanceOf(threadId)) : undefined;

  // Line comments from the diff panels; a guest's go into the composer.
  const commenting = useThreadCommenting(threadId, (text) => {
    setInsert({ text, nonce: Date.now() });
    // On phones the composer is on the thread screen.
    if (threadId && window.matchMedia("(max-width: 1023px)").matches)
      navigate(threadPath(threadId));
  });

  // Links from before the harness layer (`/code/<shelley id>`) move to the new id.
  useEffect(() => {
    if (rawId && !decodeURIComponent(rawId).includes(":")) {
      navigate(threadPath(normalizeThreadId(rawId), changesOpen ? "/changes" : ""), {
        replace: true,
      });
    }
  }, [rawId, changesOpen, navigate]);

  const sideOpen = changesOpen || prOpen;
  // The right panel's tab: Source control (`/changes`) or Pull request (`/pr`).
  const [lastTab, setLastTab] = useState<SideTab>(readSideTab);
  const showTab = useCallback(
    (tab: SideTab) => {
      if (!threadId) return;
      setLastTab(tab);
      try {
        window.localStorage.setItem(SIDE_TAB_KEY, tab);
      } catch {
        // not remembered in private mode
      }
      navigate(threadPath(threadId, tab === "pr" ? "/pr" : "/changes"));
    },
    [threadId, navigate],
  );
  // One toggle opens the panel where it was left (a thread outside a project has no PR tab).
  const togglePanel = useCallback(() => {
    if (!threadId) return;
    if (sideOpen) navigate(threadPath(threadId));
    else showTab(lastTab === "pr" && row?.projectId ? "pr" : "source");
  }, [threadId, sideOpen, lastTab, row?.projectId, navigate, showTab]);
  const showChanges = useCallback(() => showTab("source"), [showTab]);
  const project = row?.projectId ? projects?.find((p) => p.id === row.projectId) : undefined;

  useCodeShortcuts(threadId, togglePanel, toggleSidebar);

  if (slug) return <SlugRedirect slug={slug} />;
  if (harnessList !== null && harnessList.length === 0) return <NotConfigured brand={brand} />;
  if (harnessList === null) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (
    (pathname.endsWith("/changes") || pathname.endsWith("/pr") || pathname.endsWith("/review")) &&
    !threadId
  ) {
    return <Navigate to="/code" replace />;
  }

  const offline = harnesses.filter((h) => h.status.state !== "connected");

  // The Changes and Pull request panels, for a side pane or the Review page.
  const openPage = (tab: ReviewTab) =>
    threadId && navigate(threadPath(threadId, `/review${tab === "pr" ? "?tab=pr" : ""}`));
  const pullPanel = (page: boolean) =>
    threadId ? (
      <PullPanel
        threadId={threadId}
        refreshKey={`${row?.working}:${row?.cursor}:${row?.pr?.loop}`}
        onAttach={(text) => {
          setInsert({ text, nonce: Date.now() });
          // The composer is on the thread screen (on phones, and from the Review page).
          if (page || window.matchMedia("(max-width: 1023px)").matches)
            navigate(threadPath(threadId));
        }}
      />
    ) : null;
  const changesPanel = (page: boolean) => {
    if (!threadId) return null;
    if (project && reviewScope === "base") {
      return (
        <ReviewPanel
          threadId={threadId}
          baseBranch={project.baseBranch}
          refreshKey={changesKey}
          page={page}
          commenting={commenting}
          onOtherScopes={
            harness?.capabilities.workspace.diffs ? () => setReviewScope("harness") : undefined
          }
        />
      );
    }
    if (!harness || !cwd || !harness.capabilities.workspace.diffs) return null;
    return (
      <ChangesPanel
        instanceId={harness.id}
        cwd={cwd}
        refreshKey={changesKey}
        commenting={commenting}
      />
    );
  };
  const sidePane = "border-border flex w-full min-w-0 flex-col lg:w-[48%] lg:max-w-3xl lg:border-l";
  const sideTab: SideTab = prOpen && row?.projectId ? "pr" : "source";
  const sideContent = !sideOpen ? null : sideTab === "pr" ? pullPanel(false) : changesPanel(false);

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <aside
          id="code-sidebar"
          aria-label="Threads"
          data-state={sidebarOpen ? "open" : "closed"}
          className={cn(
            "border-border w-full shrink-0 flex-col border-r md:w-72 xl:w-80",
            threadId || composing || browsing || inSettings ? "hidden" : "flex",
            // With Changes open the list steps aside until there is room for all three.
            !sidebarOpen ? "md:hidden" : sideOpen ? "2xl:flex" : "md:flex",
          )}
        >
          <div className="flex h-12 shrink-0 items-center gap-1 px-2">
            <BackToApp brand={brand} />
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleSidebar}
              aria-label="Hide sidebar"
              aria-controls="code-sidebar"
              aria-expanded
              title="Hide sidebar (⌘B)"
              className="text-muted-foreground hidden md:inline-flex"
            >
              <PanelLeftClose />
            </Button>
          </div>
          <ConversationList
            threads={threads}
            harnesses={harnesses}
            activeId={threadId}
            projects={projects}
          />
          <ConnectionNotices offline={offline} />
        </aside>

        <main
          className={cn(
            "relative min-w-0 flex-1 flex-col",
            threadId
              ? sideOpen
                ? "hidden lg:flex"
                : "flex"
              : composing || browsing || inSettings
                ? "flex"
                : "hidden md:flex",
          )}
        >
          {!sidebarOpen && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleSidebar}
              aria-label="Show sidebar"
              aria-controls="code-sidebar"
              aria-expanded={false}
              title="Show sidebar (⌘B)"
              className="text-muted-foreground absolute top-2.5 left-2 z-10 hidden md:inline-flex"
            >
              <PanelLeftOpen />
            </Button>
          )}
          {inSettings ? (
            <CodeSettings
              sidebarHidden={!sidebarOpen}
              section={settingsProjectId ? "projects" : section}
              projectId={settingsProjectId}
              harnesses={harnesses}
              projects={projects}
              onChange={reloadProjects}
            />
          ) : browsing ? (
            <ThreadsScreen threads={threads} projects={projects} sidebarHidden={!sidebarOpen} />
          ) : threadId && harness && reviewOpen ? (
            <ReviewPage
              threadId={threadId}
              title={row?.title ?? threadId}
              pr={row?.pr ?? null}
              tab={reviewTab}
              onTab={(tab) => openPage(tab)}
              changes={changesPanel(true)}
              pull={row?.projectId ? pullPanel(true) : null}
              sidebarHidden={!sidebarOpen}
            />
          ) : threadId && harness ? (
            <ConversationView
              key={threadId}
              sidebarHidden={!sidebarOpen}
              id={threadId}
              harness={harness}
              rows={rows}
              externalUrl={row?.externalUrl}
              panelOpen={sideOpen}
              onTogglePanel={togglePanel}
              onShowChanges={changesOpen ? undefined : showChanges}
              inProject={Boolean(row?.projectId)}
              projectName={project?.name}
              pr={row?.pr ?? null}
              insert={insert}
              onCwd={setViewCwd}
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

        {sideContent && threadId && (
          <section className={sidePane} aria-label="Review panel">
            <ReviewSidebar
              tab={sideTab}
              onTab={showTab}
              pr={row?.pr ?? null}
              hasPull={Boolean(row?.projectId)}
              onExpand={() => openPage(sideTab === "pr" ? "pr" : "changes")}
              onClose={() => {
                setReviewScope("base");
                navigate(threadPath(threadId));
              }}
            >
              {sideContent}
            </ReviewSidebar>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * The workspace owns the full column (the app sidebar stays away), so it
 * carries its own way back to the app, like the settings screen. The
 * not-configured state shows it too, or a direct link to `/code` is a dead end.
 */
function BackToApp({ brand }: { brand: { to: string; label: string } }) {
  return (
    <Link
      to={brand.to}
      className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-8 min-w-0 items-center gap-1.5 rounded-xl px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4 shrink-0" />
      <span className="truncate">Back to {brand.label}</span>
    </Link>
  );
}

function CodeHeader({ brand }: { brand: { to: string; label: string } }) {
  return (
    <header className="border-border bg-background sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <BackToApp brand={brand} />
      <div className="ml-auto flex items-center gap-1">
        <CommandPaletteTrigger />
      </div>
    </header>
  );
}

/** No harness is configured: how to add one, with the way back to the app. */
function NotConfigured({ brand }: { brand: { to: string; label: string } }) {
  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <CodeHeader brand={brand} />
      <div className="mx-auto max-w-xl p-6">
        <EmptyState
          icon={Code2}
          title="No coding agent is connected"
          description={
            <>
              Set <code className={monoClass}>SHELLEY_URL</code> to your Shelley server (for example{" "}
              <code className={monoClass}>http://my-vm:9000</code> over Tailscale) and restart, or
              add the Claude plan in{" "}
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

/** A line per harness that is not connected, at the foot of the thread list. */
function ConnectionNotices({ offline }: { offline: HarnessInfo[] }) {
  return (
    <>
      {offline.map((h) => (
        <div
          key={h.id}
          className={cn(
            "border-border flex items-center gap-2 border-t px-4 py-1.5 text-xs",
            h.status.state === "reconnecting" ? "text-warning" : "text-muted-foreground",
          )}
          role="status"
          data-testid="code-connection"
        >
          {h.status.state === "connecting" ? (
            <Spinner className="size-3.5 shrink-0" />
          ) : (
            <TriangleAlert className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 truncate" title={h.status.detail}>
            {h.status.state === "reconnecting"
              ? `${h.label} unreachable${h.status.detail ? `: ${h.status.detail}` : ""}, retrying…`
              : h.status.state === "connecting"
                ? `Connecting to ${h.label}…`
                : `${h.label}: ${h.status.detail ?? "not ready"}`}
          </span>
        </div>
      ))}
    </>
  );
}
