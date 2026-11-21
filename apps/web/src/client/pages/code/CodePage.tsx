import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ArrowLeft, Code2, PanelLeftOpen, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  type ThreadSummary,
} from "../../lib/code/api";
import { reviewPath, reviewsApi, useProjects } from "../../lib/code/projects";
import { RESOURCE_MUTATION, RESOURCE_QUERY, useResource } from "../../queries/resource";
import { harnessOf, useCodeStore } from "../../store/code";
import { ChangesPanel } from "./ChangesPanel";
import { CodeSettings } from "./CodeSettings";
import { useLiveChanges } from "../../lib/code/use-live-changes";
import { useThreadCommenting } from "../../lib/code/comments";
import { PullPanel } from "./PullPanel";
import { ReviewPanel } from "./ReviewPanel";
import { ReviewPage, type ReviewTab } from "./ReviewPage";
import { ResizablePane } from "./ResizablePane";
import { ReviewSidebar, type SideTab } from "./ReviewSidebar";
import { PullReview } from "./PullReview";
import { ReviewsScreen } from "./ReviewsScreen";

const SIDE_TAB_KEY = "tiny-agents:code-side-tab";

function readSideTab(): SideTab {
  try {
    return window.localStorage.getItem(SIDE_TAB_KEY) === "pr" ? "pr" : "source";
  } catch {
    return "source";
  }
}
import { SidebarTop } from "../../components/shell/ModeSwitch";
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

function useSidebar(): [boolean, () => void] {
  const [open, setOpen] = useState(readSidebar);
  const toggle = useCallback(() => setOpen((shown) => !shown), []);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, open ? "open" : "closed");
    } catch {}
  }, [open]);
  return [open, toggle];
}

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

function useCodeShortcuts(
  threadId: string | undefined,
  toggleChanges: () => void,
  toggleSidebar: () => void,
) {
  const { mutate: interrupt } = useMutation({
    mutationFn: (id: string) => codeApi.interrupt(id),
    ...RESOURCE_MUTATION,
    onError: (error) => toast.error(errorMessage(error, "Could not stop it.")),
  });
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
        interrupt(threadId);
      } else if (event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        toggleChanges();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threadId, toggleChanges, toggleSidebar, interrupt]);
}

function useArchivedRow(
  threadId: string | undefined,
  threads: ThreadSummary[] | null,
): ThreadSummary | undefined {
  const listed = threads === null || threads.some((t) => t.id === threadId);
  const enabled = Boolean(threadId) && !listed;
  const archived = useQuery({
    queryKey: ["code", "threads", "archived", threadId],
    queryFn: () => codeApi.list("archived"),
    enabled,
    ...RESOURCE_QUERY,
  });
  return enabled ? archived.data?.find((r) => r.id === threadId) : undefined;
}

function SlugRedirect({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const { data: thread, loadError } = useResource(
    ["code", "threads", "by-title", slug],
    () => codeApi.byTitle(slug),
    "",
  );
  useEffect(() => {
    if (thread) navigate(threadPath(thread.id), { replace: true });
  }, [thread, navigate]);
  useEffect(() => {
    if (loadError === null) return;
    toast.error(`No thread “${slug}”.`);
    navigate("/code", { replace: true });
  }, [loadError, slug, navigate]);
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

export function CodePage() {
  const {
    conversationId: rawId,
    slug,
    section,
    projectId: settingsProjectId,
    reviewId,
  } = useParams();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { brand } = useShellConfig();
  const harnessList = useCodeStore((s) => s.harnesses);
  const statuses = useCodeStore((s) => s.statuses);
  const threads = useCodeStore((s) => s.threads);
  const [insert, setInsert] = useState<{ text: string; nonce: number } | null>(null);
  const [sidebarOpen, toggleSidebar] = useSidebar();
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
  const [reviewScope, setReviewScope] = useState<"base" | "harness">("base");
  const composing = pathname === "/code/new";
  const browsing = pathname === "/code/threads";
  const reviewing = pathname === "/code/reviews";
  const archivedRow = useArchivedRow(threadId, threads);
  const rows = useMemo(
    () => (archivedRow ? [...(threads ?? []), archivedRow] : (threads ?? [])),
    [threads, archivedRow],
  );
  const listed = useMemo(() => threads?.filter((t) => !t.review) ?? null, [threads]);
  const row = rows.find((r) => r.id === threadId);
  const cwd = row?.cwd ?? viewCwd;
  const changeVersion = useLiveChanges(
    threadId ?? null,
    cwd ?? null,
    changesOpen || (reviewOpen && reviewTab === "changes"),
  );
  const changesKey =
    changeVersion === null
      ? `${row?.working}:${row?.cursor}`
      : `live:${changeVersion}:${row?.working}`;
  const harnesses = useMemo(
    () => (harnessList ?? []).map((h) => ({ ...h, status: statuses[h.id] ?? h.status })),
    [harnessList, statuses],
  );
  const harness = threadId ? harnessOf(harnesses, instanceOf(threadId)) : undefined;

  const commenting = useThreadCommenting(threadId, (text) => {
    setInsert({ text, nonce: Date.now() });
    if (threadId && window.matchMedia("(max-width: 1023px)").matches)
      navigate(threadPath(threadId));
  });

  useEffect(() => {
    if (rawId && !decodeURIComponent(rawId).includes(":")) {
      navigate(threadPath(normalizeThreadId(rawId), changesOpen ? "/changes" : ""), {
        replace: true,
      });
    }
  }, [rawId, changesOpen, navigate]);

  const sideOpen = changesOpen || prOpen;
  const [lastTab, setLastTab] = useState<SideTab>(readSideTab);
  const showTab = useCallback(
    (tab: SideTab) => {
      if (!threadId) return;
      setLastTab(tab);
      try {
        window.localStorage.setItem(SIDE_TAB_KEY, tab);
      } catch {}
      navigate(threadPath(threadId, tab === "pr" ? "/pr" : "/changes"));
    },
    [threadId, navigate],
  );
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
  if (reviewId) {
    return <PullReview reviewId={reviewId} harnesses={harnesses} rows={rows} />;
  }

  const openPage = (tab: ReviewTab) =>
    threadId && navigate(threadPath(threadId, `/review${tab === "pr" ? "?tab=pr" : ""}`));
  const pullPanel = (page: boolean) =>
    threadId ? (
      <PullPanel
        threadId={threadId}
        refreshKey={`${row?.working}:${row?.cursor}:${row?.pr?.loop}`}
        onAttach={(text) => {
          setInsert({ text, nonce: Date.now() });
          if (page || window.matchMedia("(max-width: 1023px)").matches)
            navigate(threadPath(threadId));
        }}
        onReview={async (url) => {
          const review = await reviewsApi.open(url);
          navigate(reviewPath(review.id));
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
          editable
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
        page={page}
      />
    );
  };
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
            "bg-sidebar text-sidebar-foreground border-sidebar-border w-full shrink-0 flex-col md:w-68 md:border-r-[0.5px]",
            threadId || composing || browsing || reviewing || inSettings ? "hidden" : "flex",
            !sidebarOpen ? "md:hidden" : sideOpen ? "2xl:flex" : "md:flex",
          )}
        >
          <SidebarTop onHide={toggleSidebar} hideControls="code-sidebar" />
          <ConversationList
            threads={listed}
            harnesses={harnesses}
            activeId={threadId}
            projects={projects}
          />
          <ConnectionNotices offline={offline} />
        </aside>

        <main
          className={cn(
            "relative min-w-0 flex-1 flex-col",
            sideOpen && "lg:min-w-90",
            threadId
              ? sideOpen
                ? "hidden lg:flex"
                : "flex"
              : composing || browsing || reviewing || inSettings
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
            <ThreadsScreen threads={listed} projects={projects} sidebarHidden={!sidebarOpen} />
          ) : reviewing ? (
            <ReviewsScreen sidebarHidden={!sidebarOpen} />
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
          <ResizablePane>
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
          </ResizablePane>
        )}
      </div>
    </div>
  );
}

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
