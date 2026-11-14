/**
 * A chat session's transcript area, for the live chat and for a past chat
 * alike: the scroller, the first load's spinner, the stream's health and
 * the `Transcript` itself, fed from the session's view. What differs between
 * the two is the `ChatMode` given (lib/chat-mode.ts), flag by flag.
 */
import { useEffect, useState, type ReactNode } from "react";
import { WifiOff } from "lucide-react";
import type { Bot } from "../../shared/api/bots";
import type { ChatMode } from "../lib/chat-mode";
import type { ChatView } from "../lib/chat-session";
import { useHttpOwnerActions } from "../lib/owner-actions";
import { useOnline } from "../lib/online";
import { BotAvatar } from "./BotAvatar";
import { Transcript, type TranscriptPages } from "./Transcript";
import { Message } from "./ui/message";
import { MessageScrollerItem, MessageScrollerProvider } from "./ui/message-scroller";
import { Spinner } from "./ui/spinner";
import { TypingIndicator } from "./ui/transcript-parts";

/** True once `active` has held for `ms`: hides sub-second flickers. */
function useSettled(active: boolean, ms: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!active) {
      setSettled(false);
      return;
    }
    const timer = window.setTimeout(() => setSettled(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return active && settled;
}

/**
 * The scroller as the mode opens it. The live chat opens on the newest read
 * (anchored) message, WhatsApp-style first-unread positioning (issue #2b),
 * and `autoScroll` keeps the newest message pinned while the reader is at
 * the bottom; a past chat opens on its newest message and stays put. It
 * wraps the whole pane, so the pane can drive the scroller too (send →
 * scroll to the end).
 */
export function ChatScrollerProvider({ mode, children }: { mode: ChatMode; children: ReactNode }) {
  return (
    <MessageScrollerProvider autoScroll={mode.autoScroll} defaultScrollPosition={mode.openAt}>
      {children}
    </MessageScrollerProvider>
  );
}

/**
 * Read anchors only place the chat as it opens (issue #3: read messages are
 * the scroller's anchors, so `last-anchor` opens on the newest read one with
 * the unread block peeking in below). The scroller treats anchors as user
 * turns and re-targets them whenever the transcript's children are swapped
 * (an echo replaced by its confirmed row), which yanked the view back up to
 * an old read message while a reply streamed instead of following it. Two
 * frames after the first render with messages the initial position is
 * applied; from then on autoScroll alone keeps the newest message pinned.
 */
function useOpeningAnchors(on: boolean, hasMessages: boolean): boolean {
  const [anchoring, setAnchoring] = useState(true);
  useEffect(() => {
    if (!on || !anchoring || !hasMessages) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setAnchoring(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [on, anchoring, hasMessages]);
  return on && anchoring;
}

export interface ChatSessionTranscriptProps {
  bot: Pick<Bot, "id" | "name" | "description">;
  /** The session's view, and how to load the page above. */
  chat: ChatView & { loadOlder(): Promise<void> };
  mode: ChatMode;
}

export function ChatSessionTranscript({ bot, chat, mode }: ChatSessionTranscriptProps) {
  const ownerActions = useHttpOwnerActions(bot.id);
  const { messages } = chat;
  // The transcript's pages: older ones load on scroll (issue #92).
  const pages: TranscriptPages = {
    hasMore: chat.hasMore,
    loadingOlder: chat.loadingOlder,
    loadOlder: chat.loadOlder,
  };
  // Brief stream hiccups reconnect on their own; only a drop that lasts
  // gets the notice. The first connection is "loading", not "reconnecting".
  const reconnecting = useSettled(chat.health === "reconnecting", 1000);
  const online = useOnline();
  // A cached transcript shows while it reconnects; only an empty one waits on a spinner.
  const settledLoading = useSettled(chat.health === "loading" && messages.length === 0, 300);
  const showLoading =
    mode.loadingSpinner === "immediate" ? chat.health === "loading" : settledLoading;
  const anchoring = useOpeningAnchors(mode.scrollAnchors, messages.length > 0);

  return (
    <div className="relative min-h-0 flex-1">
      {/* Stream health: the transcript is frozen while disconnected. A
          floating pill, so the transcript does not shift under it. */}
      {mode.streamHealth && (!online || reconnecting) && (
        <div
          role="status"
          className="bg-background/90 text-muted-foreground absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1 text-xs shadow-sm"
        >
          {online ? (
            <>
              <Spinner className="size-3" aria-hidden />
              Reconnecting…
            </>
          ) : (
            <>
              <WifiOff className="size-3" aria-hidden />
              You're offline. Messages send when you're back.
            </>
          )}
        </div>
      )}
      {/* First load: outside the scroller content, which must hold only
          transcript rows for the initial positioning to apply. */}
      {showLoading && (
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center">
          <Spinner className="size-5" />
        </div>
      )}
      <Transcript
        botName={bot.name}
        pages={pages}
        timeline={chat.timeline}
        actions={mode.ownerActions ? ownerActions : undefined}
        unreadDividerId={mode.unreadDivider ? chat.unreadDividerId : undefined}
        scrollAnchor={mode.scrollAnchors ? (i) => anchoring && chat.isRead(i) : undefined}
        empty={
          mode.emptyState &&
          chat.health !== "loading" && (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
              <BotAvatar name={bot.name} className="size-20" />
              <div className="max-w-sm">
                <p className="text-foreground text-lg font-semibold">{bot.name}</p>
                {bot.description ? (
                  <p className="mt-1 text-sm">{bot.description}</p>
                ) : (
                  <p className="mt-1 text-sm">Say hi to start the conversation.</p>
                )}
              </div>
            </div>
          )
        }
        tail={
          mode.typing &&
          chat.typing && (
            <MessageScrollerItem messageId="typing">
              <Message>
                <TypingIndicator label={`${bot.name} is typing`} />
              </Message>
            </MessageScrollerItem>
          )
        }
        contentTestId={mode.contentTestId}
      />
    </div>
  );
}
