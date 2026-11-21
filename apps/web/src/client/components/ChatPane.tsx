import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Bot } from "../../shared/api/bots";
import type { CatalogModel } from "../../shared/api/models";
import { botsApi } from "../lib/bots-api";
import { useBotsStore } from "../store/bots";
import type { OwnerSubmission } from "../store/chats";
import { useChat } from "../store/use-chat";
import { useUiStore } from "../store/ui";
import { useViewerRole } from "../store/people";
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
  const chat = useChat(bot.id);
  const { messages, busy, yolo } = chat;
  const setMobileOpen = useUiStore((s) => s.setMobileOpen);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmYolo, setConfirmYolo] = useState(false);
  const role = useViewerRole();
  const owner = role === "owner";
  const [menuView, setMenuView] = useHistoryMenu();
  const composerRef = useRef<ChatComposerHandle>(null);
  const scroller = useMessageScroller();

  const held = chat.outbox.filter((entry) => !isEcho(entry));
  const setYolo = async (on: boolean) => {
    setConfirmYolo(false);
    await chat.setYolo(on);
  };
  const canReset = owner && (messages.length > 0 || chat.outbox.length > 0);

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

  const defaultModel = useBotsStore((s) => s.defaultModel);
  const model = models.find((m) => m.id === (bot.modelId ?? defaultModel));
  const composerEnabled = canAnswer && model !== undefined;

  const send = (submission: OwnerSubmission) => {
    scroller.scrollToEnd({ behavior: "auto" });
    return chat.send(submission);
  };

  const { dragging, dropHandlers } = useFileDrop(composerEnabled, composerRef);

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
      adoptBot(await botsApi.reset(bot.id));
    } catch (error) {
      toast.error(errorMessage(error, "Failed to start a new chat"));
    }
  };

  const newChatFromComposer = () => {
    if (!owner || chat.health === "loading") return false;
    if (canReset) void doReset();
    return true;
  };

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col" {...dropHandlers}>
        {dragging && <DropOverlay />}
        <ChatPaneHeader
          bot={bot}
          guest={!owner}
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

        {!canAnswer && (
          <ModelWarning anyEnabled={providers?.some((provider) => provider.enabled)} />
        )}

        <ChatSessionTranscript bot={bot} chat={chat} mode={LIVE_CHAT} />

        {held.length > 0 && (
          <QueuedMessages held={held} onWithdraw={(requestId) => void chat.withdraw(requestId)} />
        )}

        {yolo && <YoloBanner guest={!owner} onTurnOff={() => void setYolo(false)} />}

        <ChatComposer
          ref={composerRef}
          models={models}
          onModelChange={owner ? changeModel : undefined}
          bot={bot}
          model={model}
          canAnswer={canAnswer}
          busy={busy}
          onSend={send}
          onStop={chat.stop}
          onEditBot={onEditBot}
          onNewChat={role === "guest" ? undefined : newChatFromComposer}
        />
      </div>
      {live.showBrowser && (
        <BrowserPanel
          bot={bot}
          onClose={live.closeLive}
          tabs={live.liveTabs}
          layout={live.layout}
          onLayout={live.setLayout}
        />
      )}
      {live.showComputer && (
        <ComputerPanel
          bot={bot}
          onClose={live.closeLive}
          tabs={live.liveTabs}
          layout={live.layout}
          onLayout={live.setLayout}
        />
      )}

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
