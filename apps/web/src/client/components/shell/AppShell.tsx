import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bot, MessageSquare, Plus } from "lucide-react";
import { Layout } from "@groot/shell/components/Layout";
import type { CommandGroupEntry } from "@groot/shell/components/CommandPalette";
import { useBotsStore } from "../../store/bots";
import { useUiStore } from "../../store/ui";
import type { Bot as BotRow } from "../../lib/bots-api";
import { BotDialog } from "../BotDialog";
import { AppSidebar } from "./AppSidebar";
import { APP_NAV } from "./nav";

/**
 * Frame for every authenticated page: the sidebar on the left and the routed
 * page on the right. It also owns what the sidebar and the chat header share:
 * the bot list + activity feed, the model catalog, the ⌘K palette groups, and
 * the one create/edit bot dialog.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const loadBots = useBotsStore((s) => s.loadBots);
  const loadModels = useBotsStore((s) => s.loadModels);
  const connectActivity = useBotsStore((s) => s.connectActivity);
  const disconnectActivity = useBotsStore((s) => s.disconnectActivity);
  const bots = useBotsStore((s) => s.bots);
  const models = useBotsStore((s) => s.models);
  const defaultModel = useBotsStore((s) => s.defaultModel);
  const openCreateBot = useUiStore((s) => s.openCreateBot);
  const botDialogOpen = useUiStore((s) => s.botDialogOpen);
  const setBotDialogOpen = useUiStore((s) => s.setBotDialogOpen);
  const editingBot = useUiStore((s) => s.editingBot);
  const markSaved = useUiStore((s) => s.markSaved);
  const setMobileOpen = useUiStore((s) => s.setMobileOpen);

  useEffect(() => {
    void loadBots();
    void loadModels();
    connectActivity();
    return () => disconnectActivity();
  }, [loadBots, loadModels, connectActivity, disconnectActivity]);

  // The drawer must not stay open across a navigation (e.g. browser back).
  useEffect(() => setMobileOpen(false), [pathname, setMobileOpen]);

  const commandGroups = useMemo<CommandGroupEntry[]>(() => {
    const botGroup: CommandGroupEntry[] =
      bots.length === 0
        ? []
        : [
            {
              heading: "Bots",
              items: bots.map((bot) => ({
                id: bot.id,
                label: bot.name,
                icon: Bot,
                onSelect: () => navigate(`/chats/${bot.id}`),
              })),
            },
          ];
    return [
      { heading: "Actions", items: [{ label: "New bot", icon: Plus, onSelect: openCreateBot }] },
      ...botGroup,
      {
        heading: "Navigation",
        items: [
          { label: "Chats", icon: MessageSquare, onSelect: () => navigate("/chats") },
          ...APP_NAV.map((item) => ({
            label: item.label,
            icon: item.icon,
            onSelect: () => navigate(item.to),
          })),
        ],
      },
    ];
  }, [bots, navigate, openCreateBot]);

  const onSaved = (bot: BotRow) => {
    void loadBots();
    markSaved();
    // Creating a bot drops you straight into its chat (messenger model).
    if (!editingBot) navigate(`/chats/${bot.id}`);
  };

  const inChats = pathname === "/chats" || pathname.startsWith("/chats/");

  return (
    <div className="bg-background flex h-dvh overflow-hidden">
      <AppSidebar />
      <div className="h-dvh min-w-0 flex-1 overflow-y-auto">
        {/* `header` disables the shell's own sidebar and mobile bar; Layout
            stays only for the ⌘K palette and the routed Outlet. */}
        <Layout
          header={<span />}
          commandGroups={commandGroups}
          padded={!inChats}
          className="bg-background"
          mainClassName={inChats ? "h-dvh overflow-hidden" : "min-h-dvh"}
        />
      </div>
      <BotDialog
        open={botDialogOpen}
        onOpenChange={setBotDialogOpen}
        models={models}
        defaultModelId={defaultModel}
        bot={editingBot}
        onSaved={onSaved}
      />
    </div>
  );
}
