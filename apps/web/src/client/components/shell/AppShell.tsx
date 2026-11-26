import { useEffect, useMemo } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  Code2,
  LogOut,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  Settings,
  Sun,
} from "lucide-react";
import { Layout } from "@groot/shell/components/Layout";
import { Button } from "@groot/ui/button";
import type { CommandGroupEntry } from "@groot/shell/components/CommandPalette";
import { useAuthStore } from "@groot/shell/store/auth";
import { useTheme } from "@groot/shell/lib/theme";
import { toast } from "sonner";
import { chatBots, useBotsStore } from "../../store/bots";
import { modeOf, useUiStore } from "../../store/ui";
import { useCodeStore } from "../../store/code";
import { useKeyCommands } from "../keys";
import { threadPath } from "../../lib/code/api";
import type { Bot as BotRow } from "../../../shared/api/bots";
import { BotDialog } from "../BotDialog";
import { AppSidebar } from "./AppSidebar";
import { APP_NAV, guestNav } from "./nav";
import { settingsCommandGroup } from "./settings-commands";
import { sidebarCommand } from "./sidebar-command";
import { useViewerRole, usePeopleStore } from "../../store/people";
import { BADGED_FAVICON, documentTitle, waitingCount } from "../../lib/attention";

export function AppShell() {
  const { pathname, search } = useLocation();
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
  const setMobileOpen = useUiStore((s) => s.setMobileOpen);
  const logout = useAuthStore((s) => s.logout);
  const { theme, setTheme } = useTheme();

  const connectCode = useCodeStore((s) => s.connect);
  const disconnectCode = useCodeStore((s) => s.disconnect);
  const codeThreads = useCodeStore((s) => s.threads);
  const codeCommands = useKeyCommands((s) => s.commands);
  const codeConfigured = useCodeStore((s) => (s.harnesses?.length ?? 0) > 0);
  useEffect(() => {
    connectCode();
    return () => disconnectCode();
  }, [connectCode, disconnectCode]);

  const loadPeople = usePeopleStore((s) => s.load);
  const restricted = useViewerRole() !== "owner";
  useEffect(() => {
    void loadPeople();
    void loadBots();
    void loadModels();
    connectActivity();
    return () => disconnectActivity();
  }, [loadPeople, loadBots, loadModels, connectActivity, disconnectActivity]);

  useEffect(() => {
    document.title = documentTitle(pathname, bots);
  }, [pathname, bots]);
  useEffect(() => () => void (document.title = "tiny-agents"), []);
  const waiting = waitingCount(bots);
  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) return;
    icon.href = waiting > 0 ? BADGED_FAVICON : "/favicon.svg";
    return () => void (icon.href = "/favicon.svg");
  }, [waiting]);

  useEffect(() => setMobileOpen(false), [pathname, setMobileOpen]);
  const rememberPath = useUiStore((s) => s.rememberPath);
  useEffect(() => rememberPath(pathname, search), [pathname, search, rememberPath]);

  const commandGroups = useMemo<CommandGroupEntry[]>(() => {
    const listed = chatBots(bots);
    const botGroup: CommandGroupEntry[] =
      listed.length === 0
        ? []
        : [
            {
              heading: "Bots",
              items: listed.map((bot) => ({
                id: bot.id,
                label: bot.name,
                icon: Bot,
                onSelect: () => navigate(`/chats/${bot.id}`),
              })),
            },
          ];
    const codeGroup: CommandGroupEntry[] =
      codeThreads && codeThreads.length > 0
        ? [
            {
              heading: "Code",
              items: codeThreads
                .filter((c) => !c.parentId)
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice(0, 30)
                .map((c) => ({
                  id: `code-${c.id}`,
                  label: c.title,
                  icon: Code2,
                  onSelect: () => navigate(threadPath(c.id)),
                })),
            },
          ]
        : [];
    const codeActions: CommandGroupEntry[] =
      codeCommands.length > 0
        ? [
            {
              heading: pathname.startsWith("/code") ? "Code actions" : "Chat actions",
              items: codeCommands
                .filter((command) => command.enabled !== false)
                .map((command) => ({
                  id: `code-command-${command.id}`,
                  label: command.label,
                  icon: Code2,
                  shortcut: command.keys,
                  onSelect: command.run,
                })),
            },
          ]
        : [];
    const navItems = (restricted ? guestNav(APP_NAV) : APP_NAV).filter(
      (item) => item.to !== "/code" || codeConfigured,
    );
    return [
      {
        heading: "Actions",
        items: [
          sidebarCommand(modeOf(pathname)),
          ...(restricted ? [] : [{ label: "New bot", icon: Plus, onSelect: openCreateBot }]),
          ...(codeConfigured
            ? [
                {
                  label: "New coding thread",
                  icon: Code2,
                  onSelect: () => navigate("/code"),
                },
              ]
            : []),
        ],
      },
      ...codeActions,
      ...botGroup,
      ...codeGroup,
      {
        heading: "Navigation",
        items: [
          { label: "Chats", icon: MessageSquare, onSelect: () => navigate("/chats") },
          ...navItems.map((item) => ({
            label: item.label,
            icon: item.icon,
            onSelect: () => navigate(item.to),
          })),
          { label: "Settings", icon: Settings, onSelect: () => navigate("/settings") },
        ],
      },
      settingsCommandGroup(restricted, navigate),
      {
        heading: "Theme",
        items: [
          {
            label: theme === "light" ? "Light ✓" : "Light",
            icon: Sun,
            onSelect: () => setTheme("light"),
          },
          {
            label: theme === "dark" ? "Dark ✓" : "Dark",
            icon: Moon,
            onSelect: () => setTheme("dark"),
          },
          {
            label: theme === "system" ? "System ✓" : "System",
            icon: Monitor,
            onSelect: () => setTheme("system"),
          },
        ],
      },
      {
        heading: "Account",
        items: [
          {
            label: "Log out",
            icon: LogOut,
            variant: "destructive",
            onSelect: () => {
              void logout();
              toast.success("Signed out", { description: "You have been logged out safely." });
              navigate("/login");
            },
          },
        ],
      },
    ];
  }, [
    bots,
    navigate,
    openCreateBot,
    theme,
    setTheme,
    logout,
    codeThreads,
    codeCommands,
    codeConfigured,
    restricted,
    pathname,
  ]);

  const onSaved = (bot: BotRow) => {
    useBotsStore.getState().adoptBot(bot);
    if (!editingBot) navigate(`/chats/${bot.id}`);
  };

  const onDeleted = (bot: BotRow) => {
    useBotsStore.getState().forgetBot(bot.id);
    if (matchPath("/chats/:botId", pathname)?.params.botId === bot.id) {
      navigate("/chats", { replace: true });
    }
  };

  const inChats =
    pathname === "/chats" ||
    pathname.startsWith("/chats/") ||
    pathname === "/code" ||
    pathname.startsWith("/code/");
  const inSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const inCode = pathname === "/code" || pathname.startsWith("/code/");
  const fullPage = inSettings || inCode;

  return (
    <div className="bg-background flex h-dvh overflow-hidden">
      {!fullPage && <AppSidebar />}
      <div className="h-dvh min-w-0 flex-1 overflow-y-auto">
        {!inChats && !fullPage && (
          <div className="flex h-12 items-center px-2 pt-1 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="size-4" />
            </Button>
          </div>
        )}
        <Layout
          chrome={false}
          commandGroups={commandGroups}
          commandBuiltIns={false}
          padded={!inChats && !inSettings}
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
        onDeleted={onDeleted}
      />
    </div>
  );
}
