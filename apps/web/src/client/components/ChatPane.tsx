import { Fragment, useEffect, useRef, useState, type DragEvent } from "react";
import { ChevronDown, Globe, Menu, Paperclip, SquarePen, X } from "lucide-react";
import { Button } from "@groot/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { toast } from "sonner";
import { botsApi, type Bot, type ModelInfo } from "../lib/bots-api";
import { useBotsStore } from "../store/bots";
import { useUiStore } from "../store/ui";
import { BotAvatar } from "./BotAvatar";
import { BrowserPanel } from "./BrowserPanel";
import {
  ACTIVE_TOOL_STATUSES,
  ChatMessageView,
  TypingIndicator,
  USER_PILL,
  type ToolLabels,
} from "./ChatMessageView";
import { ChatComposer, type ChatComposerHandle, type ComposerSubmission } from "./ChatComposer";
import { MessageAttachments } from "./Attachments";
import { browserInUse, useBrowserPanel } from "../lib/browser-panel";
import { formatDayDivider } from "../lib/day-divider";
import { Message } from "./ui/message";
import { Spinner } from "./ui/spinner";
import type { ChatMessage, PendingMessage, QueuedMessage } from "../lib/chat-types";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "./ui/message-scroller";

// Stable empties for a chat that has not connected yet: a fresh `[]` per
// render would re-run every effect that depends on the transcript.
const NO_MESSAGES: ChatMessage[] = [];
const NO_PENDING: PendingMessage[] = [];
const NO_QUEUED: QueuedMessage[] = [];

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

/** ⌘⇧O on Apple keyboards, Ctrl+Shift+O elsewhere (ChatGPT's new-chat chord). */
const NEW_CHAT_SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⇧⌘O"
    : "Ctrl+Shift+O";

/**
 * The bot is working with nothing on screen to show it: waiting on the
 * first token, or between tool rounds. A streaming reply, a running tool
 * row or an approval card already says so on its own.
 */
function awaitingFirstOutput(messages: ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return true;
  if (last.status === "streaming") return false;
  return !last.toolCalls?.some((call) => ACTIVE_TOOL_STATUSES.has(call.status));
}

interface ChatPaneProps {
  bot: Bot;
  models: ModelInfo[];
  gatewayConfigured: boolean;
  onEditBot: () => void;
  onBotReset: (bot: Bot) => void;
}

/**
 * Column 3 (PRD §6.2): header, transcript, composer. Thin shell — the
 * transcript needs `useMessageScroller` *inside* the scroller Provider, so
 * the pane body is a child component.
 */
export function ChatPane(props: ChatPaneProps) {
  return (
    // `last-anchor` opens the transcript on the newest read (anchored)
    // message — WhatsApp-style first-unread positioning (issue #2b) —
    // instead of jumping to the very top of the history. `autoScroll` then
    // keeps the newest message pinned while the reader is at the bottom.
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
      <ChatPaneBody {...props} />
    </MessageScrollerProvider>
  );
}

function ChatPaneBody({ bot, models, gatewayConfigured, onEditBot, onBotReset }: ChatPaneProps) {
  const chat = useBotsStore((s) => s.chats[bot.id]);
  const connectChat = useBotsStore((s) => s.connectChat);
  const disconnectChat = useBotsStore((s) => s.disconnectChat);
  const resetChat = useBotsStore((s) => s.resetChat);
  const applyChatEvent = useBotsStore((s) => s.applyChatEvent);
  const refreshBotsInBackground = useBotsStore((s) => s.refreshBotsInBackground);
  const markRead = useBotsStore((s) => s.markRead);
  const setMobileOpen = useUiStore((s) => s.setMobileOpen);
  const [toolLabels, setToolLabels] = useState<ToolLabels>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const composerRef = useRef<ChatComposerHandle>(null);
  const scroller = useMessageScroller();

  // (Re)connect whenever the bot's conversation changes: a new chat
  // (resetChat dropped the cached state) moves the bot to a fresh
  // conversation, and the stream must follow it. `resetChat` closes the
  // old SSE connection, so the effect reopens a new one that gets a fresh
  // snapshot — the empty transcript of the new conversation.
  useEffect(() => {
    connectChat(bot.id);
    return () => disconnectChat(bot.id);
  }, [bot.id, bot.conversationId, connectChat, disconnectChat]);

  // Tool labels for the transcript rows come from the capability catalog.
  useEffect(() => {
    void botsApi
      .capabilities()
      .then((capabilities) =>
        setToolLabels(
          Object.fromEntries(
            capabilities.flatMap((capability) =>
              capability.tools.map((tool) => [tool.name, tool.label]),
            ),
          ),
        ),
      )
      .catch(() => undefined);
  }, []);

  // Mark read when opening a bot with unread replies.
  const unread = useBotsStore((s) => s.bots.find((b) => b.id === bot.id)?.unread);
  useEffect(() => {
    if (unread) markRead(bot.id);
  }, [markRead, unread, bot.id]);

  const messages = chat?.messages ?? NO_MESSAGES;
  const pending = chat?.pending ?? NO_PENDING;
  const queued = chat?.queued ?? NO_QUEUED;
  const busy = chat?.busy ?? false;
  const loaded = chat?.loaded ?? false;
  // Brief stream hiccups reconnect on their own; only a drop that lasts
  // gets the notice. The first connection is "loading", not "reconnecting".
  const reconnecting = useSettled(loaded && chat?.connected === false, 1000);
  const showLoading = useSettled(!loaded && messages.length === 0, 300);
  const showTyping = busy && pending.length === 0 && awaitingFirstOutput(messages);
  // A fresh conversation has nothing to start over from.
  const canReset = messages.length > 0 || pending.length > 0 || queued.length > 0;

  // ⇧⌘O / Ctrl+Shift+O asks for a new chat from anywhere in the pane.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== "o") return;
      e.preventDefault();
      if (canReset) setConfirmReset(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canReset]);

  // The Browser panel opens itself the first time the bot drives its browser
  // in this conversation (friction #37); once the owner closes it, it stays
  // closed and the header toggle shows the activity instead.
  const browserActive = browserInUse(messages);
  const browser = useBrowserPanel(bot.conversationId, browserActive);

  // Read/unread split (issue #3): messages older than the frozen pre-open
  // marker are read; the rest arrived while the owner was away. The first
  // unread gets the "New messages" divider above it, and read items are the
  // scroller's anchors — `last-anchor` opens on the newest read message
  // (WhatsApp-style), with the unread block peeking in below it.
  const unreadFrom = chat?.unreadFrom ?? null;
  // Only bot replies count as unread (friction #32): your own sent messages
  // land below the marker too, but a "New messages" flag above something
  // you wrote yourself reads as a glitch. The divider goes above the first
  // unread assistant message; read anchors keep including user messages.
  // The target is fixed by the first fresh snapshot of this visit: replies
  // that stream in while the chat is open are read as they arrive, so a
  // reply to what you just sent never gets flagged as "new".
  const [dividerId, setDividerId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!loaded || dividerId !== undefined) return;
    const first = messages.find((m) => m.role === "assistant" && m.createdAt > (unreadFrom ?? 0));
    setDividerId(first?.id ?? null);
  }, [loaded, dividerId, messages, unreadFrom]);
  const firstUnreadIndex = messages.findIndex((m) => m.createdAt > (unreadFrom ?? 0));
  const isRead = (i: number) => firstUnreadIndex === -1 || i < firstUnreadIndex;
  // Read anchors only place the chat as it opens. The scroller treats
  // anchors as user turns and re-targets them whenever the transcript's
  // children are swapped (an echo replaced by its confirmed row), which
  // yanked the view back up to an old read message while a reply streamed
  // instead of following it. Two frames after the first render with
  // messages the initial position is applied; from then on autoScroll
  // alone keeps the newest message pinned.
  const [anchoring, setAnchoring] = useState(true);
  const hasMessages = messages.length > 0;
  useEffect(() => {
    if (!anchoring || !hasMessages) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setAnchoring(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [anchoring, hasMessages]);

  const model = models.find((m) => m.id === bot.modelId);
  const composerEnabled = gatewayConfigured && model !== undefined;

  /** Rejects when the server refused, so the composer restores the draft. */
  const send = async ({ body, attachments, mentions, whenBusy }: ComposerSubmission) => {
    // Keep the just-sent message visible: the reader may be scrolled up in
    // the history, and sending is an explicit jump-to-now (issue #2a).
    scroller.scrollToEnd({ behavior: "auto" });
    // Optimistic echo: show the message immediately; the SSE queued event
    // replaces it once the server confirms the message is held (steer or
    // follow-up), and the snapshot/upsert once it is placed. If the POST
    // fails the echo is withdrawn and the text returns to the composer.
    const echo = {
      id: crypto.randomUUID(),
      // Exactly the submitted body: the store dedupes a plain echo against
      // the confirmed row by text (attachment sends by request id), so any
      // transformation here leaves both visible (cubic: doubled mention echo).
      text: body,
      createdAt: Date.now(),
      ...(attachments.length > 0 ? { attachments } : {}),
    };
    applyChatEvent(bot.id, { type: "pending-add", message: echo });
    try {
      await botsApi.send(
        bot.id,
        echo.id,
        body,
        mentions,
        attachments.map((a) => a.uploadId),
        whenBusy,
      );
    } catch (error) {
      applyChatEvent(bot.id, { type: "pending-remove", id: echo.id });
      toast.error(error instanceof Error ? error.message : "Failed to send");
      throw error;
    }
  };

  const stop = async () => {
    try {
      await botsApi.abort(bot.id);
    } catch (error) {
      toast.error("Failed to stop the reply");
      throw error;
    }
  };

  // Drop files anywhere on the conversation to attach them. dragenter and
  // dragleave fire for every child crossed, so a depth counter tells when
  // the pointer really left the pane.
  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const dropHandlers = composerEnabled
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (e.dataTransfer.files.length > 0)
            composerRef.current?.stageFiles(e.dataTransfer.files);
        },
      }
    : {};

  /** Withdraw a queued/steering message: the x on its bubble. */
  const cancelQueued = async (item: QueuedMessage) => {
    try {
      await botsApi.withdraw(bot.id, item.requestId);
      // The queued SSE event clears the bubble.
    } catch (error) {
      // A refusal means the message was placed or answered meanwhile; the
      // server's message says which.
      toast.error(
        error instanceof Error && error.message ? error.message : "Failed to cancel the message",
      );
    }
  };

  const doReset = async () => {
    setConfirmReset(false);
    try {
      const fresh = await botsApi.reset(bot.id);
      // Drop the cached chat so the effect below reconnects the SSE to the
      // bot's new conversation and a fresh (empty) snapshot arrives. The
      // list row (preview, unread) resets server-side; refresh it too.
      resetChat(bot.id);
      refreshBotsInBackground();
      onBotReset(fresh);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start a new chat");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col" {...dropHandlers}>
        {dragging && (
          <div
            className="border-ring bg-background/80 text-foreground pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed text-sm font-medium backdrop-blur-sm"
            data-testid="drop-overlay"
          >
            <Paperclip className="text-muted-foreground size-6" />
            Drop files to attach
          </div>
        )}
        {/* Header: the bot's name opens its settings (profile, tools,
            skills, delete); the right side holds two quiet icons. Floats on
            the page background, no border. */}
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
          <button
            type="button"
            onClick={onEditBot}
            className="text-foreground hover:bg-accent group/name flex h-8 min-w-0 items-center gap-2 rounded-xl px-2 text-left text-sm font-medium"
            aria-label={`Edit ${bot.name}`}
            title="Bot settings"
          >
            <BotAvatar name={bot.name} className="size-5" />
            <span className="truncate">{bot.name}</span>
            <ChevronDown className="text-muted-foreground group-hover/name:text-foreground size-3.5 shrink-0" />
          </button>
          <div className="ml-auto flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon"
              className={`text-muted-foreground hover:text-foreground relative rounded-xl ${
                browser.open ? "bg-accent text-foreground" : ""
              }`}
              onClick={browser.toggle}
              aria-label={
                browser.open
                  ? "Close browser panel"
                  : browserActive
                    ? `Open browser panel, ${bot.name} is using the browser`
                    : "Open browser panel"
              }
              aria-pressed={browser.open}
              title={
                browserActive && !browser.open ? `${bot.name} is using the browser` : "Browser"
              }
              data-testid="browser-toggle"
            >
              <Globe className="size-4" />
              {browserActive && !browser.open && (
                <span
                  className="bg-success absolute top-1.5 right-1.5 size-2 animate-pulse rounded-full"
                  aria-hidden
                  data-testid="browser-activity"
                />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground rounded-xl"
              onClick={() => setConfirmReset(true)}
              disabled={!canReset}
              aria-label="Start a new chat"
              title={`New chat (${NEW_CHAT_SHORTCUT})`}
            >
              <SquarePen className="size-4" />
            </Button>
          </div>
        </header>

        {/* Warnings */}
        {!gatewayConfigured && (
          <div className="border-b bg-destructive/10 px-4 py-2 text-destructive text-xs">
            Cloudflare AI Gateway is not configured. Set CLOUDFLARE_API_KEY, CLOUDFLARE_ACCOUNT_ID
            and CLOUDFLARE_GATEWAY_ID, then restart. Sending is disabled.
          </div>
        )}

        {/* Transcript (AI Elements Chat: Message Scroller keeps the newest
          message pinned unless the reader scrolled up). The provider mounts
          at the pane root so the body can drive it (send → scroll to end). */}
        <div className="relative min-h-0 flex-1">
          <div
            aria-hidden="true"
            className="chat-header-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-4"
          />
          {/* Stream health: the transcript is frozen while disconnected. A
              floating pill, so the transcript does not shift under it. */}
          {reconnecting && (
            <div
              role="status"
              className="bg-background/90 text-muted-foreground absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1 text-xs shadow-sm"
            >
              <Spinner className="size-3" aria-hidden />
              Reconnecting…
            </div>
          )}
          {/* First load: outside the scroller content, which must hold only
              transcript rows for the initial positioning to apply. */}
          {showLoading && (
            <div className="text-muted-foreground absolute inset-0 flex items-center justify-center">
              <Spinner className="size-5" />
            </div>
          )}
          <MessageScroller className="h-full">
            <MessageScrollerViewport className="mx-auto w-full max-w-3xl px-2.5 py-4 sm:px-5">
              <MessageScrollerContent className="space-y-4">
                {loaded && messages.length === 0 && pending.length === 0 && (
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
                )}
                {messages.map((message, i) => {
                  const prev = messages[i - 1];
                  const showDay =
                    !prev ||
                    new Date(prev.createdAt).toDateString() !==
                      new Date(message.createdAt).toDateString();
                  return (
                    <Fragment key={message.id}>
                      {showDay && (
                        <div className="text-muted-foreground flex justify-center py-2 text-xs">
                          {formatDayDivider(message.createdAt)}
                        </div>
                      )}
                      {dividerId === message.id && (
                        <div
                          data-testid="unread-divider"
                          className="text-muted-foreground/80 flex items-center gap-2 py-1 text-[11px]"
                        >
                          <span className="bg-border h-px flex-1" aria-hidden="true" />
                          New messages
                          <span className="bg-border h-px flex-1" aria-hidden="true" />
                        </div>
                      )}
                      <MessageScrollerItem
                        messageId={message.id}
                        scrollAnchor={anchoring && isRead(i)}
                      >
                        <ChatMessageView
                          message={message}
                          botName={bot.name}
                          botId={bot.id}
                          toolLabels={toolLabels}
                        />
                      </MessageScrollerItem>
                    </Fragment>
                  );
                })}
                {showTyping && (
                  <MessageScrollerItem messageId="typing">
                    <Message>
                      <TypingIndicator label={`${bot.name} is typing`} />
                    </Message>
                  </MessageScrollerItem>
                )}
                {/* Messages the server holds behind (or steering into) the
                  running reply (issue #9). They render in queue order between
                  the transcript and the in-flight echoes; placement turns
                  them into real user bubbles. */}
                {queued.map((item) => (
                  <MessageScrollerItem
                    key={`queued-${item.requestId}`}
                    messageId={`queued-${item.requestId}`}
                  >
                    <QueuedMessageView item={item} onCancel={() => void cancelQueued(item)} />
                  </MessageScrollerItem>
                ))}
                {pending.length > 0 &&
                  (() => {
                    const last = messages[messages.length - 1];
                    const showDay =
                      !last ||
                      new Date(last.createdAt).toDateString() !==
                        new Date(pending[0].createdAt).toDateString();
                    return (
                      <Fragment>
                        {showDay && (
                          <div className="text-muted-foreground flex justify-center py-2 text-xs">
                            {formatDayDivider(pending[0].createdAt)}
                          </div>
                        )}
                        {pending.map((p) => (
                          <MessageScrollerItem key={p.id} messageId={p.id}>
                            <ChatMessageView
                              message={{
                                id: p.id,
                                role: "user",
                                text: p.text,
                                ...(p.attachments?.length ? { attachments: p.attachments } : {}),
                                status: "streaming",
                                createdAt: p.createdAt,
                              }}
                              botName={bot.name}
                            />
                          </MessageScrollerItem>
                        ))}
                      </Fragment>
                    );
                  })()}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton
              direction="end"
              className="absolute right-4 bottom-4"
              aria-label="Jump to the latest message"
            />
          </MessageScroller>
        </div>

        <ChatComposer
          ref={composerRef}
          bot={bot}
          model={model}
          gatewayConfigured={gatewayConfigured}
          busy={busy}
          onSend={send}
          onStop={stop}
          onEditBot={onEditBot}
        />
      </div>
      {/* Browser live view (issue #24): beside the conversation on desktop,
          full-screen overlay on mobile. */}
      {browser.open && <BrowserPanel bot={bot} onClose={browser.close} />}

      {/* Confirmations */}
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Start a new chat?</DialogTitle>
            <DialogDescription>
              {bot.name} gets a fresh, empty conversation. The old one is kept but hidden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button onClick={doReset}>New chat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * A message the server holds while the bot is replying (issue #9): a steer
 * joins the running reply after its current tool round, a follow-up is
 * answered by the next run. Rendered like the owner's pill with its state
 * and a cancel (x) that withdraws it from the queue.
 */
function QueuedMessageView({ item, onCancel }: { item: QueuedMessage; onCancel: () => void }) {
  return (
    <Message align="end" data-testid="queued-bubble" data-mode={item.mode}>
      <div className="flex max-w-[92%] md:max-w-[80%] min-w-0 flex-col items-end gap-1">
        {item.attachments && item.attachments.length > 0 && (
          <MessageAttachments attachments={item.attachments} />
        )}
        {item.text && (
          <div className={USER_PILL}>
            <p className="whitespace-pre-wrap">{item.text}</p>
          </div>
        )}
        <div className="text-muted-foreground flex items-center gap-1 px-1 text-xs">
          <span>
            {item.mode === "steer" ? "Steering into the reply" : "Queued for the next reply"}
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="hover:bg-accent hover:text-foreground flex size-5 items-center justify-center rounded-full"
            aria-label="Cancel this message"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    </Message>
  );
}
