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

/** Desktop layout (the sidebar is on screen), tracked live across resizes. */
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

/**
 * Chat area beside the sidebar (PRD §6.2): the open bot's chat. `/chats` is
 * not a page of its own on desktop, where the sidebar already lists the
 * bots: it opens the last-opened bot (else the sidebar's top one). On
 * mobile with no bot open it is the full-screen bot list, the app's home.
 * With no bots at all it is the "create your first bot" screen everywhere.
 */
export function ChatWorkspace() {
  const { botId, chatId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const bots = useBotsStore((s) => s.bots);
  const loading = useBotsStore((s) => s.loading);
  const models = useBotsStore((s) => s.models);
  const gatewayConfigured = useBotsStore((s) => s.gatewayConfigured);
  const openCreateBot = useUiStore((s) => s.openCreateBot);
  const openEditBot = useUiStore((s) => s.openEditBot);
  const setMobileOpen = useUiStore((s) => s.setMobileOpen);
  const loadBot = useBotsStore((s) => s.loadBot);
  useFocusParam();

  // `/chats?new=1` (older links, the command palette) opens the create dialog.
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

  // The chat needs fields the list entry lacks: the store's full row, read
  // fresh on open and again when "New chat" moves the bot to a fresh
  // conversation. A save updates the row in the store, so no refetch then.
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

  // Desktop never rests on a bare /chats: land in a conversation. A link to
  // a bot that no longer exists goes to that landing bot on desktop, and
  // back to the bot list on phones, which keep /chats as their home.
  useEffect(() => {
    if (!loaded || currentId) return;
    if (!desktop && !botId) return;
    const target = desktop ? landingBotId(bots) : null;
    navigate(target ? `/chats/${target}` : "/chats", { replace: true });
  }, [loaded, currentId, desktop, botId, bots, navigate]);

  return (
    <div className="h-full min-h-0">
      {fullBot && currentListBot && chatId ? (
        // A past chat (issue #101), read-only until continued.
        <PastChatPane key={`${fullBot.id}-${chatId}`} bot={fullBot} chatId={chatId} />
      ) : fullBot && currentListBot ? (
        <ChatPane
          key={fullBot.id}
          bot={fullBot}
          models={models}
          gatewayConfigured={gatewayConfigured}
          onEditBot={() => void openEditBot(fullBot.id)}
        />
      ) : (
        <>
          {/* Mobile, nothing open: the bot list is the screen (messenger flow). */}
          {!noBots && (
            <div className="flex h-full flex-col md:hidden">
              <div className="flex shrink-0 items-center gap-3 px-3 pt-4 pb-2">
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
              <div className="min-h-0 flex-1 overflow-y-auto pb-4">
                <BotsSection bots={bots} activeId={null} />
              </div>
            </div>
          )}
          {noBots && (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
              <div className="bg-muted text-foreground flex size-14 items-center justify-center rounded-2xl">
                <Bot className="size-7" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Create your first bot</h2>
                <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                  Every contact here is an AI agent you chat with — pick a persona and a model, and
                  it remembers the whole conversation.
                </p>
              </div>
              <Button onClick={openCreateBot}>
                <Bot className="size-4" />
                Create your first bot
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
