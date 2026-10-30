import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { History, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@groot/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { botsApi, type PastChat } from "../lib/bots-api";
import { messageCountLabel, pastChatRange, pastChatTitle } from "../lib/past-chats";
import { previewLine } from "../lib/bot-groups";

interface ChatHistoryMenuProps {
  botId: string;
  /** The bot's current conversation: a change ("New chat", continue) refetches the list. */
  conversationId: string;
  /** The past chat on screen, if any: marked in the list, with a way back to the current one. */
  activeChatId?: string;
  /** Controlled open state, so the sidebar's "Chat history" item can open it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * The chat header's history button (issue #101): the bot's past chats, the
 * most recently ended first. Hidden until the bot has one.
 */
export function ChatHistoryMenu({
  botId,
  conversationId,
  activeChatId,
  open,
  onOpenChange,
}: ChatHistoryMenuProps) {
  const navigate = useNavigate();
  const [chats, setChats] = useState<PastChat[] | null>(null);
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = open ?? innerOpen;

  // Refetch when the bot changes chats, and on every open: the title
  // side-call may have renamed the chat that just ended.
  useEffect(() => {
    let cancelled = false;
    void botsApi
      .pastChats(botId)
      .then((next) => !cancelled && setChats(next))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [botId, conversationId, activeChatId, isOpen]);

  const setOpen = (next: boolean) => {
    setInnerOpen(next);
    onOpenChange?.(next);
  };

  // Asked to open (the sidebar's "Chat history") with nothing to list yet.
  const empty = chats !== null && chats.length === 0;
  useEffect(() => {
    if (!isOpen || !empty) return;
    toast.info("No past chats yet. Starting a new chat keeps this one here.");
    setInnerOpen(false);
    onOpenChange?.(false);
  }, [isOpen, empty, onOpenChange]);

  if (!chats || chats.length === 0) return null;

  return (
    <DropdownMenu open={isOpen} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`text-muted-foreground hover:text-foreground rounded-xl ${
            activeChatId ? "bg-accent text-foreground" : ""
          }`}
          aria-label="Chat history"
          title="Chat history"
          data-testid="chat-history-toggle"
        >
          <History className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[min(28rem,70vh)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto"
      >
        <DropdownMenuLabel>Chat history</DropdownMenuLabel>
        {activeChatId && (
          <>
            <DropdownMenuItem onSelect={() => navigate(`/chats/${botId}`)}>
              <MessageSquare className="size-4" />
              Current chat
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {chats.map((chat) => (
          <DropdownMenuItem
            key={chat.id}
            onSelect={() => navigate(`/chats/${botId}/history/${chat.id}`)}
            aria-current={chat.id === activeChatId ? "page" : undefined}
            className={`flex-col items-start gap-0.5 ${chat.id === activeChatId ? "bg-accent" : ""}`}
            data-testid="past-chat-item"
          >
            <span className="w-full truncate text-sm font-medium">{pastChatTitle(chat)}</span>
            <span className="text-muted-foreground text-xs">
              {pastChatRange(chat)} · {messageCountLabel(chat.messageCount)}
            </span>
            {chat.lastMessagePreview && (
              <span className="text-muted-foreground w-full truncate text-xs">
                {previewLine(chat.lastMessagePreview)}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
