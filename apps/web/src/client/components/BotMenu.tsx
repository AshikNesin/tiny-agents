import { useEffect, useRef } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, History, Settings2, Zap } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import type { Bot } from "../lib/bots-api";
import { BotAvatar } from "./BotAvatar";
import { PastChatItems, usePastChats } from "./ChatHistoryMenu";

/** Which page of the menu is showing; null while it is closed. */
export type BotMenuView = "main" | "history" | null;

interface BotMenuProps {
  bot: Bot;
  view: BotMenuView;
  onViewChange: (view: BotMenuView) => void;
  onEditBot: () => void;
  yolo: boolean;
  /** Turning YOLO on is the caller's to confirm. */
  onYoloChange: (on: boolean) => void;
}

/**
 * The chat header's bot name, and the bot's menu behind it: settings, the
 * past chats (a second page of the same menu, so it opens in place on a
 * phone) and the chat's YOLO switch. The header keeps only the live view and
 * New chat as icons beside it.
 */
export function BotMenu({ bot, view, onViewChange, onEditBot, yolo, onYoloChange }: BotMenuProps) {
  const chats = usePastChats(bot.id, bot.conversationId, view);
  const contentRef = useRef<HTMLDivElement>(null);

  // Switching pages unmounts the focused row: hand focus to the new first row
  // so the arrow keys keep working.
  useEffect(() => {
    if (!view) return;
    const frame = requestAnimationFrame(() =>
      contentRef.current?.querySelector<HTMLElement>("[role^=menuitem]")?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [view]);

  const goTo = (next: BotMenuView) => (event: Event) => {
    event.preventDefault();
    onViewChange(next);
  };

  return (
    <DropdownMenu open={view !== null} onOpenChange={(open) => onViewChange(open ? "main" : null)}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="text-foreground hover:bg-muted data-[state=open]:bg-muted focus-visible:ring-ring/50 flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-left font-medium outline-none focus-visible:ring-3"
          aria-label={`${bot.name} menu`}
          title={bot.description || undefined}
        >
          <BotAvatar name={bot.name} className="size-5" />
          <span className="truncate">{bot.name}</span>
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        align="start"
        className="max-h-[min(28rem,70vh)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto"
      >
        {view === "history" ? (
          <>
            <DropdownMenuItem onSelect={goTo("main")} className="text-muted-foreground">
              <ChevronLeft />
              Chat history
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {chats && chats.length === 0 && (
              <p className="text-muted-foreground px-2 py-1.5 text-sm">
                No past chats yet. Starting a new chat keeps this one here.
              </p>
            )}
            {chats && <PastChatItems botId={bot.id} chats={chats} />}
          </>
        ) : (
          <>
            {bot.description && (
              <>
                <p className="text-muted-foreground line-clamp-3 px-2 py-1.5 text-xs">
                  {bot.description}
                </p>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={onEditBot}>
              <Settings2 />
              Bot settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={goTo("history")}>
              <History />
              Chat history
              <ChevronRight className="text-muted-foreground ml-auto" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={yolo}
              onCheckedChange={(on) => onYoloChange(on === true)}
              className="items-start"
              data-testid="yolo-toggle"
            >
              <Zap className={`mt-0.5 ${yolo ? "text-warning" : ""}`} />
              <span className="flex flex-col">
                YOLO mode
                <span className="text-muted-foreground text-xs">
                  Run tools without asking (vault still asks)
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
