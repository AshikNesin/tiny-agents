import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  ChevronDown,
  Cpu,
  Globe,
  Menu,
  Monitor,
  Paperclip,
  SquarePen,
  Users,
  X,
  WifiOff,
  Zap,
} from "lucide-react";
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
import { Link, useSearchParams } from "react-router-dom";
import { botsApi, type Bot, type CatalogModel } from "../lib/bots-api";
import { useBotsStore } from "../store/bots";
import type { OwnerSubmission } from "../store/chats";
import { useChat } from "../store/use-chat";
import { useUiStore } from "../store/ui";
import { useIsGuest } from "../store/people";
import { BotAvatar } from "./BotAvatar";
import { BrowserPanel } from "./BrowserPanel";
import { ComputerPanel } from "./ComputerPanel";
import { ChatHistoryMenu } from "./ChatHistoryMenu";
import { TypingIndicator } from "./ui/transcript-parts";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";
import { Transcript, type TranscriptPages } from "./Transcript";
import {
  browserInUse,
  computerInUse,
  useBrowserPanel,
  useComputerPanel,
} from "../lib/browser-panel";
import { SHOW_COMPUTER_EVENT } from "../lib/owner-actions";
import { useHttpOwnerActions } from "../lib/owner-actions";
import { Message } from "./ui/message";
import { Spinner } from "./ui/spinner";
import { isEcho, type OutboxEntry } from "../lib/chat-session";
import {
  MessageScrollerItem,
  MessageScrollerProvider,
  useMessageScroller,
} from "./ui/message-scroller";
import { errorMessage } from "../lib/errors";
import { useOnline } from "../lib/online";

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

interface ChatPaneProps {
  bot: Bot;
  models: CatalogModel[];
  canAnswer: boolean;
  onEditBot: () => void;
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

function ChatPaneBody({ bot, models, canAnswer, onEditBot }: ChatPaneProps) {
  const providers = useBotsStore((s) => s.providers);
  const adoptBot = useBotsStore((s) => s.adoptBot);
  // The chat, ready to render: the stream, Echoes and held messages,
  // typing, stream health and the unread divider live behind it.
  const chat = useChat(bot.id);
  const { messages, busy, yolo } = chat;
  const setMobileOpen = useUiStore((s) => s.setMobileOpen);
  const ownerActions = useHttpOwnerActions(bot.id);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmYolo, setConfirmYolo] = useState(false);
  // A guest (issue #145) chats; settings, New chat and Chat history stay the owner's.
  const guest = useIsGuest();
  // `?history=1` (the sidebar row's "Chat history") opens the history menu.
  const [searchParams, setSearchParams] = useSearchParams();
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    if (searchParams.get("history") !== "1") return;
    setHistoryOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("history");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const composerRef = useRef<ChatComposerHandle>(null);
  const scroller = useMessageScroller();

  // The transcript's pages: older ones load on scroll (issue #92).
  const pages: TranscriptPages = {
    hasMore: chat.hasMore,
    loadingOlder: chat.loadingOlder,
    loadOlder: chat.loadOlder,
  };
  // Held by the server behind (or steering into) the reply; Echoes are in the timeline.
  const held = chat.outbox.filter((entry) => !isEcho(entry));
  // YOLO mode (issue #151): the owner's per-chat switch; the stream says its state.
  const setYolo = async (on: boolean) => {
    setConfirmYolo(false);
    await chat.setYolo(on);
  };
  // Brief stream hiccups reconnect on their own; only a drop that lasts
  // gets the notice. The first connection is "loading", not "reconnecting".
  const reconnecting = useSettled(chat.health === "reconnecting", 1000);
  const online = useOnline();
  // A cached transcript shows while it reconnects; only an empty one waits on a spinner.
  const showLoading = useSettled(chat.health === "loading" && messages.length === 0, 300);
  // A fresh conversation has nothing to start over from.
  const canReset = !guest && (messages.length > 0 || chat.outbox.length > 0);

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
  // One live view at a time: the panel opened last is in front.
  const [front, setFront] = useState<"browser" | "computer">("browser");
  const browser = useBrowserPanel(bot.conversationId, browserActive, () => setFront("browser"));
  // The Computer panel (issue #108) follows the same rule, and also opens
  // when the bot asks the owner to take over its computer.
  const computerActive = computerInUse(messages);
  const computer = useComputerPanel(bot.conversationId, computerActive, () => setFront("computer"));
  // Whether this server has a computer at all; the toggle hides otherwise.
  const [computerConfigured, setComputerConfigured] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(() => botsApi.computerStatus(bot.id))
      .then((status) => {
        if (!cancelled) setComputerConfigured(Boolean(status?.configured));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bot.id]);
  const showBrowser = browser.open && (!computer.open || front === "browser");
  const showComputer = computer.open && (!browser.open || front === "computer");
  const toggleBrowser = () =>
    browser.open && !showBrowser ? setFront("browser") : browser.toggle();
  const toggleComputer = () =>
    computer.open && !showComputer ? setFront("computer") : computer.toggle();
  // "Open computer" on a takeover card in the transcript.
  const showComputerPanel = computer.show;
  useEffect(() => {
    const onShow = () => showComputerPanel();
    window.addEventListener(SHOW_COMPUTER_EVENT, onShow);
    return () => window.removeEventListener(SHOW_COMPUTER_EVENT, onShow);
  }, [showComputerPanel]);

  // Read/unread split (issue #3): the chat's "New messages" divider sits
  // above the first reply that arrived while the owner was away, and read
  // messages are the scroller's anchors — `last-anchor` opens on the newest
  // read message (WhatsApp-style), with the unread block peeking in below.
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

  // A bot without a model of its own runs on the default model.
  const defaultModel = useBotsStore((s) => s.defaultModel);
  const model = models.find((m) => m.id === (bot.modelId ?? defaultModel));
  const composerEnabled = canAnswer && model !== undefined;

  const send = (submission: OwnerSubmission) => {
    // Keep the just-sent message visible: the reader may be scrolled up in
    // the history, and sending is an explicit jump-to-now (issue #2a).
    scroller.scrollToEnd({ behavior: "auto" });
    return chat.send(submission);
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

  // The composer's model chip: switching it saves the bot, like its settings.
  const changeModel = async (modelId: string) => {
    if (modelId === bot.modelId) return;
    try {
      adoptBot(await botsApi.update(bot.id, { modelId }));
    } catch (error) {
      toast.error(errorMessage(error, "Could not switch the model"));
    }
  };

  const doReset = async () => {
    setConfirmReset(false);
    try {
      // The bot is on a fresh conversation: the chat reopens there, empty.
      adoptBot(await botsApi.reset(bot.id));
    } catch (error) {
      toast.error(errorMessage(error, "Failed to start a new chat"));
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
        {/* Header: one line, as on the Code page — the bot's name (opens its
            settings), what it runs on, then the live views and the chat's
            actions as quiet icons. */}
        <header className="border-border flex h-13 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu />
          </Button>
          {/* The page's heading is the bot's name; the name opens its settings. */}
          <h1 className="flex min-w-0 items-center text-sm">
            <button
              type="button"
              onClick={guest ? undefined : onEditBot}
              disabled={guest}
              className="text-foreground enabled:hover:bg-muted focus-visible:ring-ring/50 flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-left font-medium outline-none focus-visible:ring-3 disabled:cursor-default"
              aria-label={guest ? bot.name : `Edit ${bot.name}`}
              title={guest ? undefined : "Bot settings"}
            >
              <BotAvatar name={bot.name} className="size-5" />
              <span className="truncate">{bot.name}</span>
              {!guest && <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />}
            </button>
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
          {(bot.description || model) && (
            <span className="text-muted-foreground hidden min-w-0 shrink-[4] items-center gap-2 overflow-hidden text-xs lg:flex">
              {bot.description && <span className="truncate">{bot.description}</span>}
              {bot.description && model && (
                <span className="text-muted-foreground/60" aria-hidden>
                  ·
                </span>
              )}
              {model && (
                <span className="flex shrink-0 items-center gap-1" title={model.providerName}>
                  <Cpu className="size-3.5 shrink-0" />
                  {model.name}
                </span>
              )}
            </span>
          )}
          <span className="min-w-2 flex-1" />
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              className={`text-muted-foreground hover:text-foreground relative ${
                showBrowser ? "bg-accent text-foreground" : ""
              }`}
              onClick={toggleBrowser}
              aria-label={
                showBrowser
                  ? "Close browser panel"
                  : browserActive
                    ? `Open browser panel, ${bot.name} is using the browser`
                    : "Open browser panel"
              }
              aria-pressed={showBrowser}
              title={browserActive && !showBrowser ? `${bot.name} is using the browser` : "Browser"}
              data-testid="browser-toggle"
            >
              <Globe className="size-4" />
              {browserActive && !showBrowser && (
                <span
                  className="bg-success absolute top-1 right-1 size-1.5 animate-pulse rounded-full"
                  aria-hidden
                  data-testid="browser-activity"
                />
              )}
            </Button>
            {(computerConfigured || computer.open || computerActive) && (
              <Button
                variant="ghost"
                size="icon-sm"
                className={`text-muted-foreground hover:text-foreground relative ${
                  showComputer ? "bg-accent text-foreground" : ""
                }`}
                onClick={toggleComputer}
                aria-label={
                  showComputer
                    ? "Close computer panel"
                    : computerActive
                      ? `Open computer panel, ${bot.name} is using the computer`
                      : "Open computer panel"
                }
                aria-pressed={showComputer}
                title={
                  computerActive && !showComputer ? `${bot.name} is using the computer` : "Computer"
                }
                data-testid="computer-toggle"
              >
                <Monitor className="size-4" />
                {computerActive && !showComputer && (
                  <span
                    className="bg-success absolute top-1 right-1 size-1.5 animate-pulse rounded-full"
                    aria-hidden
                    data-testid="computer-activity"
                  />
                )}
              </Button>
            )}
            {!guest && (
              <Button
                variant="ghost"
                size="icon-sm"
                className={
                  yolo
                    ? "bg-warning/15 text-warning hover:text-warning"
                    : "text-muted-foreground hover:text-foreground"
                }
                onClick={() => (yolo ? void setYolo(false) : setConfirmYolo(true))}
                aria-label={yolo ? "Turn off YOLO mode" : "Turn on YOLO mode"}
                aria-pressed={yolo}
                title={
                  yolo
                    ? "YOLO mode is on: tools run without asking (vault still asks)"
                    : "YOLO mode: run tools in this chat without asking"
                }
                data-testid="yolo-toggle"
              >
                <Zap className="size-4" />
              </Button>
            )}
            {!guest && (
              <ChatHistoryMenu
                botId={bot.id}
                conversationId={bot.conversationId}
                open={historyOpen}
                onOpenChange={setHistoryOpen}
              />
            )}
            {!guest && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setConfirmReset(true)}
                disabled={!canReset}
                aria-label="Start a new chat"
                title={`New chat (${NEW_CHAT_SHORTCUT})`}
              >
                <SquarePen className="size-4" />
              </Button>
            )}
          </div>
        </header>

        {/* Warnings */}
        {!canAnswer && (
          <div className="border-b bg-destructive/10 px-4 py-2 text-destructive text-xs">
            {providers?.some((provider) => provider.enabled) ? (
              <>No model can run right now. Check the accounts in </>
            ) : (
              <>No model is set up. Add one in </>
            )}
            <Link to="/settings/models" className="font-medium underline underline-offset-2">
              Settings → Models
            </Link>
            . Sending is disabled.
          </div>
        )}

        {/* Transcript (AI Elements Chat: Message Scroller keeps the newest
          message pinned unless the reader scrolled up). The provider mounts
          at the pane root so the body can drive it (send → scroll to end). */}
        <div className="relative min-h-0 flex-1">
          {/* Stream health: the transcript is frozen while disconnected. A
              floating pill, so the transcript does not shift under it. */}
          {(!online || reconnecting) && (
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
            actions={ownerActions}
            unreadDividerId={chat.unreadDividerId}
            scrollAnchor={(i) => anchoring && chat.isRead(i)}
            empty={
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
              <>
                {chat.typing && (
                  <MessageScrollerItem messageId="typing">
                    <Message>
                      <TypingIndicator label={`${bot.name} is typing`} />
                    </Message>
                  </MessageScrollerItem>
                )}
              </>
            }
          />
        </div>

        {/* Messages the server holds behind (or steering into) the running
            reply (issue #9), as compact rows over the composer like the Code
            page's queue; placement turns them into real bubbles. */}
        {held.length > 0 && (
          <ul
            className="mx-auto flex w-full max-w-[784px] flex-col items-end gap-1 px-4 pt-2 md:px-5"
            aria-label="Waiting to send"
          >
            {held.map((item) => (
              <QueuedMessageView
                key={`queued-${item.requestId}`}
                item={item}
                onCancel={() => void chat.withdraw(item.requestId)}
              />
            ))}
          </ul>
        )}

        {yolo && (
          <div
            role="status"
            data-testid="yolo-banner"
            className="mx-auto flex w-full max-w-[784px] items-center gap-2 px-4 pt-2 text-xs md:px-5"
          >
            <span className="bg-warning/10 text-warning flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-3 py-1.5">
              <Zap className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                YOLO on — tools run without asking (vault items still ask)
              </span>
            </span>
            {!guest && (
              <Button size="xs" variant="ghost" onClick={() => void setYolo(false)}>
                Turn off
              </Button>
            )}
          </div>
        )}

        <ChatComposer
          ref={composerRef}
          models={models}
          onModelChange={guest ? undefined : changeModel}
          bot={bot}
          model={model}
          canAnswer={canAnswer}
          busy={busy}
          onSend={send}
          onStop={chat.stop}
          onEditBot={onEditBot}
        />
      </div>
      {/* Browser live view (issue #24): beside the conversation on desktop,
          full-screen overlay on mobile. */}
      {showBrowser && <BrowserPanel bot={bot} onClose={browser.close} />}
      {/* Computer live view (issue #108): same place, one panel at a time. */}
      {showComputer && <ComputerPanel bot={bot} onClose={computer.close} />}

      {/* Confirmations */}
      <Dialog open={confirmYolo} onOpenChange={setConfirmYolo}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Turn on YOLO mode?</DialogTitle>
            <DialogDescription>
              {bot.name} runs every tool call in this chat without asking you first, including ones
              already waiting. Anything that uses a vault item still asks, and so do turns another
              bot or a guest started. It stays on until you turn it off or start a new chat.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmYolo(false)}>
              Cancel
            </Button>
            <Button onClick={() => void setYolo(true)}>Turn on</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Start a new chat?</DialogTitle>
            <DialogDescription>
              {bot.name} gets a fresh, empty conversation. This one moves to Chat history, where you
              can read or continue it.
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
 * answered by the next run. One compact row over the composer (the Code
 * page's queue) with its state and a cancel (x) that withdraws it.
 */
function QueuedMessageView({ item, onCancel }: { item: OutboxEntry; onCancel: () => void }) {
  const files = item.attachments?.length ?? 0;
  const steering = item.state === "steering";
  return (
    <li
      data-testid="queued-bubble"
      data-mode={steering ? "steer" : "followUp"}
      className="bg-muted/60 flex max-w-[85%] min-w-0 items-center gap-2 rounded-2xl py-1 pr-1 pl-3 text-sm"
    >
      <span className="text-muted-foreground shrink-0 text-xs">
        {steering ? "Steering" : "Queued"}
      </span>
      <span className="min-w-0 flex-1 truncate" title={item.text}>
        {item.text}
      </span>
      {files > 0 && (
        <span className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-xs">
          <Paperclip className="size-3" />
          {files}
        </span>
      )}
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={onCancel}
        aria-label="Cancel this message"
        title={steering ? "Joins the running reply · cancel" : "Sent after this reply · cancel"}
      >
        <X />
      </Button>
    </li>
  );
}
