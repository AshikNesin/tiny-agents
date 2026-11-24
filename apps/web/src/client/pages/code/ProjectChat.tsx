import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@groot/ui";
import { ChatPane } from "../../components/ChatPane";
import { Spinner } from "../../components/ui/spinner";
import { projectsApi } from "../../lib/code/projects";
import { useResource } from "../../queries/resource";
import { useBotsStore } from "../../store/bots";
import { useUiStore } from "../../store/ui";

export function ProjectChat({ projectId }: { projectId: string }) {
  const { data: opened, loadError } = useResource(
    ["code", "project-chat", projectId],
    () => projectsApi.openChat(projectId),
    "Could not open the project chat.",
  );
  const adoptBot = useBotsStore((s) => s.adoptBot);
  const refreshBots = useBotsStore((s) => s.refreshBotsInBackground);
  const bot = useBotsStore((s) => (opened ? (s.fullBots[opened.id] ?? opened) : null));
  const models = useBotsStore((s) => s.models);
  const canAnswer = useBotsStore((s) => s.canAnswer);
  const openEditBot = useUiStore((s) => s.openEditBot);
  const navigate = useNavigate();

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
    <ChatPane
      key={bot.id}
      bot={bot}
      models={models}
      canAnswer={canAnswer}
      onEditBot={() => void openEditBot(bot.id)}
      onOpenMenu={() => navigate("/code")}
    />
  );
}
