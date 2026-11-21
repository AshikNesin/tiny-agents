import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Bot, Menu } from "lucide-react";
import { Button } from "@groot/ui/button";
import { useBotsStore } from "../../store/bots";
import { useUiStore } from "../../store/ui";
import { landingBotId, rememberLastBot } from "../../lib/last-bot";
import { useFocusParam } from "../../lib/focus-param";
import { ChatPane } from "../../components/ChatPane";
import { PastChatPane } from "../../components/PastChatPane";
import { BotsSection } from "../../components/shell/BotsSection";

const DESKTOP_QUERY = "(min-width: 768px)";
function subscribeDesktop(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function isDesktop(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DESKTOP_QUERY).matches;
}

export function ChatWorkspace() {
  const { botId, chatId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const bots = useBotsStore((s) => s.bots);
  const loading = useBotsStore((s) => s.loading);
  const models = useBotsStore((s) => s.models);
  const canAnswer = useBotsStore((s) => s.canAnswer);
  const openCreateBot = useUiStore((s) => s.openCreateBot);
  const openEditBot = useUiStore((s) => s.openEditBot);
  const setMobileOpen = useUiStore((s) => s.setMobileOpen);
  const loadBot = useBotsStore((s) => s.loadBot);
  useFocusParam();

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    openCreateBot();
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, openCreateBot]);

  const currentListBot = useMemo(() => bots.find((b) => b.id === botId) ?? null, [bots, botId]);
  const currentId = currentListBot?.id;
  const currentConversation = currentListBot?.conversationId;

  const fullBot = useBotsStore((s) => (currentId ? (s.fullBots[currentId] ?? null) : null));
  useEffect(() => {
    if (!currentId) return;
    void loadBot(currentId, { fresh: true }).catch(() => undefined);
  }, [currentId, currentConversation, loadBot]);

  const noBots = bots.length === 0 && !loading;
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const loaded = !loading && bots.length > 0;

  useEffect(() => {
    if (currentId) rememberLastBot(currentId);
  }, [currentId]);

  useEffect(() => {
    if (!loaded || currentId) return;
    if (!desktop && !botId) return;
    const target = desktop ? landingBotId(bots) : null;
    navigate(target ? `/chats/${target}` : "/chats", { replace: true });
  }, [loaded, currentId, desktop, botId, bots, navigate]);

  return (
    <div className="h-full min-h-0">
      {fullBot && currentListBot && chatId ? (
        <PastChatPane key={`${fullBot.id}-${chatId}`} bot={fullBot} chatId={chatId} />
      ) : fullBot && currentListBot ? (
        <ChatPane
          key={fullBot.id}
          bot={fullBot}
          models={models}
          canAnswer={canAnswer}
          onEditBot={() => void openEditBot(fullBot.id)}
        />
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center gap-3 px-3 pt-4 pb-2 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </Button>
            <h1 className="text-lg font-semibold">Chats</h1>
          </div>
          {!noBots && (
            <div className="min-h-0 flex-1 overflow-y-auto pb-4 md:hidden">
              <BotsSection bots={bots} activeId={null} />
            </div>
          )}
          {noBots && (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
              <div className="bg-muted text-foreground flex size-14 items-center justify-center rounded-2xl">
                <Bot className="size-7" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Create your first bot</h2>
                <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                  Every contact here is an AI agent you chat with. Pick a persona and a model, and
                  it remembers the whole conversation.
                </p>
              </div>
              <Button onClick={openCreateBot}>
                <Bot className="size-4" />
                Create your first bot
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
