import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Bot } from "lucide-react";
import { Button } from "@groot/ui/button";
import { useBotsStore } from "../../store/bots";
import { botsApi, type Bot as BotRow, type ModelInfo } from "../../lib/bots-api";
import { BotList } from "../../components/BotList";
import { BotDialog } from "../../components/BotDialog";
import { BotAvatar } from "../../components/BotAvatar";
import { ChatPane } from "../../components/ChatPane";

/**
 * Three-column chat workspace (PRD §6.2): shell nav (outside this layout),
 * bot list, chat pane. Mobile: list and chat are separate full-screen views.
 */
export function ChatWorkspace() {
  const { botId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const bots = useBotsStore((s) => s.bots);
  const loading = useBotsStore((s) => s.loading);
  const gatewayConfigured = useBotsStore((s) => s.gatewayConfigured);
  const defaultModel = useBotsStore((s) => s.defaultModel);
  const loadBots = useBotsStore((s) => s.loadBots);
  const loadModels = useBotsStore((s) => s.loadModels);
  const connectActivity = useBotsStore((s) => s.connectActivity);
  const disconnectActivity = useBotsStore((s) => s.disconnectActivity);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BotRow | null>(null);
  const [fullBot, setFullBot] = useState<BotRow | null>(null);

  useEffect(() => {
    void loadBots();
    void loadModels();
    connectActivity();
    return () => disconnectActivity();
  }, [loadBots, loadModels, connectActivity, disconnectActivity]);

  const refreshModels = useCallback(() => {
    void botsApi
      .models()
      .then((r) => setModels(r.models))
      .catch(() => undefined);
  }, []);
  useEffect(refreshModels, [refreshModels, location.pathname]);

  const currentListBot = useMemo(() => bots.find((b) => b.id === botId) ?? null, [bots, botId]);

  // Editing + chat need full fields the list doesn't carry.
  useEffect(() => {
    if (currentListBot) {
      void botsApi
        .get(currentListBot.id)
        .then(setFullBot)
        .catch(() => setFullBot(null));
    } else {
      setFullBot(null);
    }
  }, [currentListBot?.id]);

  const onSaved = (bot: BotRow) => {
    void loadBots();
    if (editing && bot.id === editing.id) setFullBot(bot);
    // Creating a bot drops you straight into its chat (messenger model).
    if (!editing) navigate(`/chats/${bot.id}`);
  };

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = () => {
    if (fullBot) {
      setEditing(fullBot);
      setDialogOpen(true);
    }
  };

  const isMobileChat = Boolean(botId);

  return (
    <div className="flex h-full min-h-0">
      {/* Column 2 — bot list. Full-screen on mobile; hidden once a chat opens. */}
      <aside
        className={
          isMobileChat
            ? "hidden w-72 shrink-0 border-r md:flex md:flex-col"
            : "flex h-full w-full flex-col border-r md:w-72 md:shrink-0"
        }
      >
        <BotList bots={bots} onNewBot={openCreate} />
      </aside>

      {/* Column 3 — chat pane or empty state */}
      <main
        className={isMobileChat ? "h-full min-w-0 flex-1" : "hidden h-full min-w-0 flex-1 md:block"}
      >
        {fullBot && currentListBot ? (
          <ChatPane
            key={fullBot.id}
            bot={fullBot}
            models={models}
            gatewayConfigured={gatewayConfigured}
            onEditBot={openEdit}
            onBotDeleted={() => void loadBots()}
            onBotReset={(fresh) => setFullBot(fresh)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            {bots.length === 0 && !loading ? (
              <>
                <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl">
                  <Bot className="size-7" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Create your first bot</h2>
                  <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                    Every contact here is an AI agent you chat with — pick a persona and a model,
                    and it remembers the whole conversation.
                  </p>
                </div>
                <Button onClick={openCreate}>
                  <Bot className="size-4" />
                  Create your first bot
                </Button>
              </>
            ) : (
              /* Featured bot (Grok-style): the most recent contact, shown
                 large and centered, tappable to open. */
              <button
                type="button"
                onClick={() => bots[0] && navigate(`/chats/${bots[0].id}`)}
                className="group flex flex-col items-center gap-3 rounded-3xl px-10 py-6"
              >
                {bots[0] && (
                  <BotAvatar
                    name={bots[0].name}
                    className="size-28 transition-transform group-hover:scale-105"
                  />
                )}
                <span className="text-muted-foreground text-lg font-semibold">
                  {bots[0]?.name ?? "Pick a bot or create one"}
                </span>
              </button>
            )}
          </div>
        )}
      </main>

      <BotDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        models={models}
        defaultModelId={defaultModel}
        bot={editing}
        onSaved={onSaved}
      />
    </div>
  );
}
