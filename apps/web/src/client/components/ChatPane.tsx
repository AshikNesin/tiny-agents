import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Square,
  Trash2,
  SendHorizonal,
} from "lucide-react";
import { Button } from "@groot/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@groot/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
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
import { BotAvatar } from "./BotAvatar";
import { ChatMessageView, type ToolLabels } from "./ChatMessageView";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./ui/message-scroller";

interface ChatPaneProps {
  bot: Bot;
  models: ModelInfo[];
  gatewayConfigured: boolean;
  onEditBot: () => void;
  onBotDeleted: () => void;
  onBotReset: (bot: Bot) => void;
}

/** Column 3 (PRD §6.2): header, transcript, composer. */
export function ChatPane({
  bot,
  models,
  gatewayConfigured,
  onEditBot,
  onBotDeleted,
  onBotReset,
}: ChatPaneProps) {
  const navigate = useNavigate();
  const chat = useBotsStore((s) => s.chats[bot.id]);
  const connectChat = useBotsStore((s) => s.connectChat);
  const disconnectChat = useBotsStore((s) => s.disconnectChat);
  const resetChat = useBotsStore((s) => s.resetChat);
  const applyChatEvent = useBotsStore((s) => s.applyChatEvent);
  const refreshBotsInBackground = useBotsStore((s) => s.refreshBotsInBackground);
  const [text, setText] = useState("");
  const [toolLabels, setToolLabels] = useState<ToolLabels>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    if (unread) void botsApi.read(bot.id).catch(() => undefined);
  }, [unread, bot.id]);

  const messages = chat?.messages ?? [];
  const pending = chat?.pending ?? [];
  const busy = chat?.busy ?? false;
  const waiting = messages.some((m) =>
    m.toolCalls?.some((call) => call.status === "awaiting_approval"),
  );
  const modelKnown = models.some((m) => m.id === bot.modelId);
  const modelName = models.find((m) => m.id === bot.modelId)?.name ?? bot.modelId;
  const canSend = gatewayConfigured && modelKnown && !busy && text.trim().length > 0;

  const send = async () => {
    const body = text.trim();
    if (!body || !canSend) return;
    setText("");
    // Optimistic echo: show the message immediately; the SSE snapshot/upsert
    // replaces it once the server confirms (store dedupes by text). If the
    // POST fails the echo is withdrawn and the text returns to the composer.
    const echo = { id: crypto.randomUUID(), text: body, createdAt: Date.now() };
    applyChatEvent(bot.id, { type: "pending-add", message: echo });
    try {
      await botsApi.send(bot.id, echo.id, body);
    } catch (error) {
      applyChatEvent(bot.id, { type: "pending-remove", id: echo.id });
      toast.error(error instanceof Error ? error.message : "Failed to send");
      setText(body);
    }
  };

  const stop = async () => {
    try {
      await botsApi.abort(bot.id);
    } catch {
      toast.error("Failed to stop the reply");
    }
  };

  const doDelete = async () => {
    setConfirmDelete(false);
    try {
      await botsApi.remove(bot.id);
      onBotDeleted();
      navigate("/chats", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete bot");
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
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b px-3 py-2.5 md:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => navigate("/chats")}
          aria-label="Back to bots"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <BotAvatar
          name={bot.name}
          emoji={bot.avatarEmoji}
          color={bot.avatarColor}
          className="size-8"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{bot.name}</div>
          <div className="text-muted-foreground truncate text-xs">
            {waiting ? (
              <span className="text-primary">needs your approval</span>
            ) : busy ? (
              <span className="text-primary">typing…</span>
            ) : (
              modelName
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
          <MessageSquarePlus className="size-4" />
          <span className="hidden sm:inline">New chat</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Bot menu">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEditBot}>
              <Pencil className="size-4" /> Edit bot
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> Delete bot
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Stream health: the transcript is frozen while disconnected */}
      {chat && !chat.connected && (
        <div className="flex items-center gap-2 border-b bg-muted px-4 py-1.5 text-muted-foreground text-xs">
          <span className="bg-muted-foreground/60 size-1.5 animate-pulse rounded-full" />
          Reconnecting…
        </div>
      )}

      {/* Warnings */}
      {!gatewayConfigured && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-destructive text-xs">
          Cloudflare AI Gateway is not configured. Set CLOUDFLARE_API_KEY, CLOUDFLARE_ACCOUNT_ID and
          CLOUDFLARE_GATEWAY_ID, then restart. Sending is disabled.
        </div>
      )}
      {gatewayConfigured && !modelKnown && (
        <div className="border-b bg-muted px-4 py-2 text-muted-foreground text-xs">
          {bot.modelId} is no longer in the model catalog. Pick a new model (⋯ → Edit bot) to send
          messages again.
        </div>
      )}

      {/* Transcript (AI Elements Chat: Message Scroller keeps the newest
          message pinned unless the reader scrolled up) */}
      <div className="relative min-h-0 flex-1">
        <MessageScrollerProvider>
          <MessageScroller className="h-full">
            <MessageScrollerViewport className="px-3 py-4 md:px-4">
              <MessageScrollerContent className="space-y-4">
                {messages.length === 0 && pending.length === 0 && (
                  <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
                    <BotAvatar
                      name={bot.name}
                      emoji={bot.avatarEmoji}
                      color={bot.avatarColor}
                      className="size-12 text-lg"
                    />
                    <p>Say hi to {bot.name}</p>
                    {bot.description && <p className="text-xs">{bot.description}</p>}
                  </div>
                )}
                {messages.map((message) => (
                  <MessageScrollerItem key={message.id} messageId={message.id}>
                    <ChatMessageView
                      message={message}
                      botName={bot.name}
                      botEmoji={bot.avatarEmoji}
                      botColor={bot.avatarColor}
                      botId={bot.id}
                      toolLabels={toolLabels}
                    />
                  </MessageScrollerItem>
                ))}
                {pending.map((p) => (
                  <MessageScrollerItem key={p.id} messageId={p.id}>
                    <ChatMessageView
                      message={{
                        id: p.id,
                        role: "user",
                        text: p.text,
                        status: "streaming",
                        createdAt: p.createdAt,
                      }}
                      botName={bot.name}
                      botEmoji={bot.avatarEmoji}
                      botColor={bot.avatarColor}
                    />
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton
              direction="end"
              className="absolute right-4 bottom-4"
              aria-label="Jump to the latest message"
            />
          </MessageScroller>
        </MessageScrollerProvider>
      </div>

      {/* Composer (AI Elements Prompt Input: an input group with the send
          and stop affordances inline) */}
      <div className="border-t px-3 py-3 md:px-4">
        <InputGroup className="mx-auto max-w-3xl">
          <InputGroupTextarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={`Message ${bot.name}…`}
            rows={1}
            disabled={!gatewayConfigured || !modelKnown}
          />
          <InputGroupAddon align="inline-end">
            {busy ? (
              <InputGroupButton
                variant="outline"
                size="icon-sm"
                onClick={stop}
                aria-label="Stop generating"
              >
                <Square className="size-3.5" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                size="icon-sm"
                onClick={send}
                disabled={!canSend}
                aria-label="Send message"
              >
                <SendHorizonal className="size-3.5" />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
        <p className="text-muted-foreground mt-1.5 text-center text-[11px]">
          {modelName} · AI can make mistakes — check important details.
        </p>
      </div>

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
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {bot.name}?</DialogTitle>
            <DialogDescription>
              The bot is removed from the app. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={doDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
