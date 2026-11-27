import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { MessagesSquare, PanelRight } from "lucide-react";
import { EmptyState } from "@groot/ui";
import { Button } from "@groot/ui/button";
import { cn } from "@groot/ui/lib/utils";
import { ChatPane } from "../../components/ChatPane";
import { Spinner } from "../../components/ui/spinner";
import { projectThreads, statusSections } from "../../lib/code/list";
import { projectsApi, useProjects } from "../../lib/code/projects";
import { useResource } from "../../queries/resource";
import { useBotsStore } from "../../store/bots";
import { useCodeStore } from "../../store/code";
import { useUiStore } from "../../store/ui";
import { ProjectPanel } from "./ProjectPanel";
import { ProjectSidePane } from "./ResizablePane";

const PHONE = "(max-width: 1023px)";

const phoneNow = () => typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches;

function usePhone(): boolean {
  return useSyncExternalStore((change) => {
    if (typeof window.matchMedia !== "function") return () => undefined;
    const query = window.matchMedia(PHONE);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, phoneNow);
}

function ThreadsToggle({
  projectId,
  pressed,
  onToggle,
}: {
  projectId: string;
  pressed: boolean;
  onToggle(): void;
}) {
  const threads = useCodeStore((s) => s.threads);
  const needs =
    statusSections(projectThreads(threads ?? [], projectId, "")).find(
      (section) => section.key === "needs-you",
    )?.rows.length ?? 0;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(
        "text-muted-foreground hover:text-foreground relative",
        pressed && "bg-accent text-foreground",
      )}
      onClick={onToggle}
      aria-pressed={pressed}
      aria-label={needs > 0 ? `Threads, ${needs} need you` : "Threads"}
      title="Threads and context"
    >
      <PanelRight className="size-4" />
      {needs > 0 && (
        <span className="bg-warning absolute top-1 right-1 size-1.5 rounded-full" aria-hidden />
      )}
    </Button>
  );
}

export function ProjectChat({
  projectId,
  onOpenMenu,
}: {
  projectId: string;
  onOpenMenu: () => void;
}) {
  const chat = useResource(
    ["code", "project-chat", projectId],
    () => projectsApi.openChat(projectId),
    "Could not open the project chat.",
  );
  const opened =
    chat.status === "ready" ? chat.data : chat.status === "failed" ? (chat.last ?? null) : null;
  const loadError = chat.status === "failed" ? chat.loadError : null;
  const adoptBot = useBotsStore((s) => s.adoptBot);
  const refreshBots = useBotsStore((s) => s.refreshBotsInBackground);
  const bot = useBotsStore((s) => (opened ? (s.fullBots[opened.id] ?? opened) : null));
  const models = useBotsStore((s) => s.models);
  const canAnswer = useBotsStore((s) => s.canAnswer);
  const openEditBot = useUiStore((s) => s.openEditBot);
  const { projects } = useProjects();
  const project = projects?.find((p) => p.id === projectId);
  const phone = usePhone();
  const [params, setParams] = useSearchParams();
  const threadId = params.get("thread");
  const [open, setOpen] = useState(false);
  const shown = open || Boolean(threadId);
  const showThread = useCallback(
    (id: string | null) => setParams(id ? { thread: id } : {}),
    [setParams],
  );
  const toggle = useCallback(() => {
    if (shown && threadId) setParams({}, { replace: true });
    setOpen(!shown);
  }, [shown, threadId, setParams]);

  useEffect(() => {
    if (!opened) return;
    adoptBot(opened);
    refreshBots();
  }, [opened, adoptBot, refreshBots]);

  if (loadError) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="The project chat is not open"
        description={loadError}
      />
    );
  }
  if (!bot) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0">
      <div hidden={(phone && shown) || undefined} className="flex h-full min-w-0 flex-1 flex-col">
        <ChatPane
          key={bot.id}
          bot={bot}
          models={models}
          canAnswer={canAnswer}
          onEditBot={() => void openEditBot(bot.id)}
          onOpenMenu={onOpenMenu}
          headerActions={<ThreadsToggle projectId={projectId} pressed={shown} onToggle={toggle} />}
        />
      </div>
      {shown && (
        <ProjectSidePane>
          <ProjectPanel
            projectId={projectId}
            project={project}
            threadId={threadId}
            onThread={showThread}
            onClose={toggle}
          />
        </ProjectSidePane>
      )}
    </div>
  );
}

export function OpenProjectChat() {
  const { projectId = "" } = useParams();
  const { search } = useLocation();
  const chat = useResource(
    ["code", "project-chat", projectId],
    () => projectsApi.openChat(projectId),
    "Could not open the project chat.",
  );
  const opened =
    chat.status === "ready" ? chat.data : chat.status === "failed" ? (chat.last ?? null) : null;
  const loadError = chat.status === "failed" ? chat.loadError : null;
  const adoptBot = useBotsStore((s) => s.adoptBot);
  useEffect(() => {
    if (opened) adoptBot(opened);
  }, [opened, adoptBot]);

  if (loadError) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="The project chat is not open"
        description={loadError}
      />
    );
  }
  if (!opened) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return <Navigate to={`/chats/${encodeURIComponent(opened.id)}${search}`} replace />;
}
