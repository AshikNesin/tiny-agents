import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { History, MessageSquare } from "lucide-react";
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

/**
 * The bot's past chats, the most recently ended first; null until loaded.
 * Refetched when the bot changes chats and whenever `refresh` changes (an
 * open menu): the title side-call may have renamed the chat that just ended.
 */
export function usePastChats(botId: string, conversationId: string, refresh: unknown) {
  const [chats, setChats] = useState<PastChat[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void botsApi
      .pastChats(botId)
      .then((next) => !cancelled && setChats(next))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [botId, conversationId, refresh]);
  return chats;
}

/** One menu row per past chat: title, range, size and last line. Lives in a `DropdownMenuContent`. */
export function PastChatItems({
  botId,
  chats,
  activeChatId,
}: {
  botId: string;
  chats: PastChat[];
  activeChatId?: string;
}) {
  const navigate = useNavigate();
  return chats.map((chat) => (
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
  ));
}

interface ChatHistoryMenuProps {
  botId: string;
  /** The bot's current conversation: a change (continue) refetches the list. */
  conversationId: string;
  /** The past chat on screen: marked in the list, with a way back to the current one. */
  activeChatId: string;
}

/**
 * A past chat's header history button (issue #101): the bot's other past
 * chats and the way back to the current one. The live chat lists its past
 * chats in the bot menu instead (`BotMenu`).
 */
export function ChatHistoryMenu({ botId, conversationId, activeChatId }: ChatHistoryMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const chats = usePastChats(botId, conversationId, `${activeChatId}:${open}`);

  if (!chats || chats.length === 0) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="bg-accent text-foreground"
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
        <DropdownMenuItem onSelect={() => navigate(`/chats/${botId}`)}>
          <MessageSquare className="size-4" />
          Current chat
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <PastChatItems botId={botId} chats={chats} activeChatId={activeChatId} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
