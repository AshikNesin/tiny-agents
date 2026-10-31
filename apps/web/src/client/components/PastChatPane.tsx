import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Menu, MessageSquareReply, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@groot/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { useConfirm } from "@groot/ui/primitives";
import { toast } from "sonner";
import { botsApi, type Bot, type PastChatView } from "../lib/bots-api";
import { useBotsStore } from "../store/bots";
import { useUiStore } from "../store/ui";
import { BotAvatar } from "./BotAvatar";
import { ChatHistoryMenu } from "./ChatHistoryMenu";
import { Transcript, type TranscriptPages } from "./Transcript";
import { oldestEntryId, prependOlder } from "../lib/chat-history";
import { messageCountLabel, pastChatRange, pastChatTitle } from "../lib/past-chats";
import { Spinner } from "./ui/spinner";
import type { ChatMessage, RoutineRunCard } from "../lib/chat-types";

const NO_RUNS: RoutineRunCard[] = [];
import { MessageScrollerProvider } from "./ui/message-scroller";
import { errorMessage } from "../lib/errors";

interface PastChatPaneProps {
  bot: Bot;
  chatId: string;
  /** The bot moved back onto this chat ("Continue this chat"). */
  onContinued: (bot: Bot) => void;
}

/**
 * A past chat (issue #101), read-only: the transcript as it was, opening on
 * its newest messages with older ones loading on scroll, and the routine
 * results that landed while it was the bot's chat. The composer's place
 * holds "Continue this chat", which moves the bot back onto it.
 */
export function PastChatPane(props: PastChatPaneProps) {
  return (
    <MessageScrollerProvider defaultScrollPosition="end">
      <PastChatPaneBody {...props} />
    </MessageScrollerProvider>
  );
}

function PastChatPaneBody({ bot, chatId, onContinued }: PastChatPaneProps) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const setMobileOpen = useUiStore((s) => s.setMobileOpen);
  const resetChat = useBotsStore((s) => s.resetChat);
  const refreshBotsInBackground = useBotsStore((s) => s.refreshBotsInBackground);
  const [view, setView] = useState<PastChatView | null>(null);
  const [loaded, setLoaded] = useState<{ messages: ChatMessage[]; hasMore: boolean }>({
    messages: [],
    hasMore: false,
  });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    void botsApi
      .pastChat(bot.id, chatId)
      .then((next) => {
        if (cancelled) return;
        setView(next);
        setLoaded({ messages: next.state.messages, hasMore: Boolean(next.state.hasMore) });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error(errorMessage(error, "Failed to open the past chat"));
        navigate(`/chats/${bot.id}`, { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [bot.id, chatId, navigate]);

  // The transcript's pages: the first came with the view, older ones load on
  // scroll. A page that no longer fits (another chat opened meanwhile) is dropped.
  const pages: TranscriptPages = {
    ...loaded,
    loadingOlder,
    loadOlder: async () => {
      const before = oldestEntryId(loaded.messages);
      if (!before) return;
      setLoadingOlder(true);
      try {
        const page = await botsApi.pastChatHistory(bot.id, chatId, before);
        setLoaded((current) =>
          oldestEntryId(current.messages) === before
            ? prependOlder(current.messages, page)
            : current,
        );
      } catch {
        // Stay loadable: the next scroll to the top tries again.
      } finally {
        setLoadingOlder(false);
      }
    },
  };

  const runs = view?.runs ?? NO_RUNS;
  const chat = view?.chat;
  const title = chat ? pastChatTitle(chat) : "";

  const goToCurrent = () => navigate(`/chats/${bot.id}`);

  const continueChat = async () => {
    setBusy(true);
    try {
      const fresh = await botsApi.continuePastChat(bot.id, chatId);
      // The bot is on another conversation now: the live chat reconnects to it.
      resetChat(bot.id);
      refreshBotsInBackground();
      onContinued(fresh);
      navigate(`/chats/${bot.id}`, { replace: true });
      toast.success("Chat continued. The one you left is in Chat history.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to continue the chat"));
      setBusy(false);
    }
  };

  const deleteChat = async () => {
    const ok = await confirm({
      title: "Delete this chat?",
      description: `"${title}" is removed from ${bot.name}'s chat history. This can't be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await botsApi.deletePastChat(bot.id, chatId);
      navigate(`/chats/${bot.id}`, { replace: true });
      toast.success("Chat deleted");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete the chat"));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 px-3">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-xl md:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground rounded-xl"
          onClick={goToCurrent}
          aria-label="Back to current chat"
          title="Back to current chat"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="flex min-w-0 items-center gap-2 px-1 text-sm font-medium">
          <BotAvatar name={bot.name} className="size-5 shrink-0" />
          <span className="truncate">{bot.name}</span>
          {chat && (
            // Phones keep the header for the bot's name; the footer names the chat.
            <span className="text-muted-foreground hidden min-w-0 truncate font-normal sm:inline">
              · {title}
            </span>
          )}
        </h1>
        <div className="ml-auto flex shrink-0 items-center">
          <ChatHistoryMenu
            botId={bot.id}
            conversationId={bot.conversationId}
            activeChatId={chatId}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground rounded-xl"
                aria-label="Past chat actions"
                title="More"
                disabled={!chat}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void continueChat()} disabled={busy}>
                <MessageSquareReply className="size-4" /> Continue this chat
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => void deleteChat()}>
                <Trash2 className="size-4" /> Delete chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          aria-hidden="true"
          className="chat-header-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-4"
        />
        {!view && (
          <div className="text-muted-foreground absolute inset-0 flex items-center justify-center">
            <Spinner className="size-5" />
          </div>
        )}
        {/* No owner actions: what still waits in a past chat can no longer be answered. */}
        <Transcript
          botName={bot.name}
          pages={pages}
          routineRuns={runs}
          contentTestId="past-chat-transcript"
        />
      </div>

      {/* The composer's place: this chat has ended, and how to pick it up again. */}
      <footer className="mx-auto w-full max-w-3xl shrink-0 px-2.5 pb-4 sm:px-5">
        <div
          className="bg-muted/60 flex flex-col gap-3 rounded-3xl border px-4 py-3 sm:flex-row sm:items-center"
          data-testid="past-chat-footer"
        >
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-foreground truncate font-medium">
              Past chat{chat ? ` · ${title}` : ""}
            </p>
            <p className="text-muted-foreground text-xs">
              {chat
                ? `${pastChatRange(chat)} · ${messageCountLabel(chat.messageCount)} · ended when you started a new chat`
                : "Loading…"}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={goToCurrent}>
              Current chat
            </Button>
            <Button onClick={() => void continueChat()} disabled={!chat || busy}>
              {busy ? <Spinner className="size-4" /> : <MessageSquareReply className="size-4" />}
              Continue this chat
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
