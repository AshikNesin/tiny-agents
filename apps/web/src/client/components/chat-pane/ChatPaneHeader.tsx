import { Globe, History, Menu, MonitorPlay, SquarePen, Users } from "lucide-react";
import { Button } from "@groot/ui/button";
import type { Bot } from "../../../shared/api/bots";
import { BotAvatar } from "../BotAvatar";
import { BotMenu, type BotMenuView } from "../BotMenu";
import type { LiveViews } from "./live-views";

const NEW_CHAT_SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⇧⌘O"
    : "Ctrl+Shift+O";

export function ChatPaneHeader({
  bot,
  guest,
  menuView,
  onMenuViewChange,
  onEditBot,
  yolo,
  onYoloChange,
  live,
  canReset,
  onOpenMenu,
  onNewChat,
}: {
  bot: Bot;
  guest: boolean;
  menuView: BotMenuView;
  onMenuViewChange: (view: BotMenuView) => void;
  onEditBot: () => void;
  yolo: boolean;
  onYoloChange: (on: boolean) => void;
  live: Pick<LiveViews, "hasComputer" | "liveShown" | "liveBusy" | "liveLabel" | "toggleLive">;
  canReset: boolean;
  onOpenMenu: () => void;
  onNewChat: () => void;
}) {
  const { hasComputer, liveShown, liveBusy, liveLabel, toggleLive } = live;
  return (
    <header className="border-border flex h-13 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 md:hidden"
        onClick={onOpenMenu}
        aria-label="Open menu"
      >
        <Menu />
      </Button>
      <h1 className="flex min-w-0 items-center text-sm">
        {guest ? (
          <span
            className="text-foreground flex h-8 min-w-0 items-center gap-2 px-2 font-medium"
            title={bot.description || undefined}
          >
            <BotAvatar name={bot.name} className="size-5" />
            <span className="truncate">{bot.name}</span>
          </span>
        ) : (
          <BotMenu
            bot={bot}
            view={menuView}
            onViewChange={onMenuViewChange}
            onEditBot={onEditBot}
            yolo={yolo}
            onYoloChange={onYoloChange}
          />
        )}
        {(bot.guestIds?.length ?? 0) > 0 && (
          <span
            className="text-muted-foreground flex items-center gap-1 px-1 text-xs"
            title="Shared chat: everyone in it sees every message"
          >
            <Users className="size-3.5" />
            <span className="hidden sm:inline">Shared</span>
          </span>
        )}
      </h1>
      <span className="min-w-2 flex-1" />
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className={`text-muted-foreground hover:text-foreground relative ${
            liveShown ? "bg-accent text-foreground" : ""
          }`}
          onClick={toggleLive}
          aria-label={liveLabel}
          aria-pressed={liveShown}
          title={liveBusy ? liveLabel.replace("Open live view, ", "") : "Live view"}
          data-testid="live-view-toggle"
        >
          {hasComputer ? <MonitorPlay className="size-4" /> : <Globe className="size-4" />}
          {liveBusy && (
            <span
              className="bg-success absolute top-1 right-1 size-1.5 animate-pulse rounded-full"
              aria-hidden
              data-testid="live-view-activity"
            />
          )}
        </Button>
        {!guest && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onMenuViewChange("history")}
            aria-label="Past chats"
            title="Past chats (h)"
          >
            <History className="size-4" />
          </Button>
        )}
        {!guest && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={onNewChat}
            disabled={!canReset}
            aria-label="Start a new chat"
            title={`New chat (n or ${NEW_CHAT_SHORTCUT})`}
          >
            <SquarePen className="size-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
