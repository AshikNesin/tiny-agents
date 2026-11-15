import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Bot } from "../../shared/api/bots";
import type { CatalogModel } from "../../shared/api/models";
import { botsApi } from "../lib/bots-api";
import { useBotsStore } from "../store/bots";
import type { OwnerSubmission } from "../store/chats";
import { useChat } from "../store/use-chat";
import { useUiStore } from "../store/ui";
import { useIsGuest } from "../store/people";
import { BrowserPanel } from "./BrowserPanel";
import { ComputerPanel } from "./ComputerPanel";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";
import { ChatScrollerProvider, ChatSessionTranscript } from "./ChatSessionTranscript";
import { LIVE_CHAT } from "../lib/chat-mode";
import { isEcho } from "../lib/chat-session";
import { useMessageScroller } from "./ui/message-scroller";
import { errorMessage } from "../lib/errors";
import { ChatPaneHeader } from "./chat-pane/ChatPaneHeader";
import { ModelWarning, YoloBanner } from "./chat-pane/ChatPaneNotices";
import { NewChatConfirmDialog, YoloConfirmDialog } from "./chat-pane/ChatPaneConfirmations";
import { DropOverlay, useFileDrop } from "./chat-pane/file-drop";
import { useLiveViews } from "./chat-pane/live-views";
import { QueuedMessages } from "./chat-pane/QueuedMessages";
import { useHistoryMenu } from "./chat-pane/use-history-menu";

interface ChatPaneProps {
  bot: Bot;
  models: CatalogModel[];
  canAnswer: boolean;
  onEditBot: () => void;
}

/**
 * Column 3 (PRD §6.2): header, transcript, composer. Thin shell — the
 * transcript needs `useMessageScroller` *inside* the scroller Provider, so
 * the pane body is a child component. The transcript is the chat session in
 * its live mode (lib/chat-mode.ts); the header, notices, held messages, file
 * drop, live views and confirmations are in `chat-pane/`.
 */
export function ChatPane(props: ChatPaneProps) {
  return (
    <ChatScrollerProvider mode={LIVE_CHAT}>
      <ChatPaneBody {...props} />
    </ChatScrollerProvider>
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
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmYolo, setConfirmYolo] = useState(false);
  // A guest (issue #145) chats; settings, New chat and Chat history stay the owner's.
  const guest = useIsGuest();
  const [menuView, setMenuView] = useHistoryMenu();
  const composerRef = useRef<ChatComposerHandle>(null);
  const scroller = useMessageScroller();

  // Held by the server behind (or steering into) the reply; Echoes are in the timeline.
  const held = chat.outbox.filter((entry) => !isEcho(entry));
  // YOLO mode (issue #151): the owner's per-chat switch; the stream says its state.
  const setYolo = async (on: boolean) => {
    setConfirmYolo(false);
    await chat.setYolo(on);
  };
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

  const live = useLiveViews(bot, messages);

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

  const { dragging, dropHandlers } = useFileDrop(composerEnabled, composerRef);

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
        {dragging && <DropOverlay />}
        <ChatPaneHeader
          bot={bot}
          guest={guest}
          menuView={menuView}
          onMenuViewChange={setMenuView}
          onEditBot={onEditBot}
          yolo={yolo}
          onYoloChange={(on) => (on ? setConfirmYolo(true) : void setYolo(false))}
          live={live}
          canReset={canReset}
          onOpenMenu={() => setMobileOpen(true)}
          onNewChat={() => setConfirmReset(true)}
        />

        {/* Warnings */}
        {!canAnswer && (
          <ModelWarning anyEnabled={providers?.some((provider) => provider.enabled)} />
        )}

        {/* Transcript (AI Elements Chat: Message Scroller keeps the newest
          message pinned unless the reader scrolled up), with the stream's
          health and the unread divider. The provider mounts at the pane root
          so the body can drive it (send → scroll to end). */}
        <ChatSessionTranscript bot={bot} chat={chat} mode={LIVE_CHAT} />

        {held.length > 0 && (
          <QueuedMessages held={held} onWithdraw={(requestId) => void chat.withdraw(requestId)} />
        )}

        {yolo && <YoloBanner guest={guest} onTurnOff={() => void setYolo(false)} />}

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
      {live.showBrowser && <BrowserPanel bot={bot} onClose={live.closeLive} tabs={live.liveTabs} />}
      {/* Computer live view (issue #108): same place, one panel at a time. */}
      {live.showComputer && (
        <ComputerPanel bot={bot} onClose={live.closeLive} tabs={live.liveTabs} />
      )}

      {/* Confirmations */}
      <YoloConfirmDialog
        botName={bot.name}
        open={confirmYolo}
        onOpenChange={setConfirmYolo}
        onTurnOn={() => void setYolo(true)}
      />
      <NewChatConfirmDialog
        botName={bot.name}
        open={confirmReset}
        onOpenChange={setConfirmReset}
        onReset={doReset}
      />
    </div>
  );
}
