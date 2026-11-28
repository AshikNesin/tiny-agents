import { useState } from "react";
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
import type { PastChat } from "../../shared/api/bots";
import { messageCountLabel, pastChatRange, pastChatTitle } from "../lib/past-chats";
import { previewLine } from "../lib/bot-groups";
import { usePastChatList } from "../queries/bots";
import { useRefreshOn } from "../queries/resource";

export function usePastChats(
  botId: string,
  conversationId: string,
  view: string | null,
): PastChat[] | null {
  const chats = usePastChatList(botId);
  useRefreshOn(`${conversationId}:${view}`, chats.refresh);
  if (chats.status === "ready") return chats.data;
  if (chats.status === "failed") return chats.last ?? null;
  return null;
}

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
  conversationId: string;
  activeChatId: string;
}

export function ChatHistoryMenu({ botId, conversationId, activeChatId }: ChatHistoryMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const chats = usePastChats(botId, conversationId, `${activeChatId}:${open}`);

  if (!chats || chats.length === 0) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="bg-accent text-foreground"
            aria-label="Chat history"
            title="Chat history"
            data-testid="chat-history-toggle"
          />
        }
      >
        <History className="size-4" />
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
