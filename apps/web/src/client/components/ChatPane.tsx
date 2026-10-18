import { useEffect, useRef, useState } from "react";
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
import { Textarea } from "@groot/ui/textarea";
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
import { ChatMessageView } from "./ChatMessageView";

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
  const applyChatEvent = useBotsStore((s) => s.applyChatEvent);
  const [text, setText] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    connectChat(bot.id);
    return () => disconnectChat(bot.id);
  }, [bot.id, connectChat, disconnectChat]);

  // Mark read when opening a bot with unread replies.
  const unread = useBotsStore((s) => s.bots.find((b) => b.id === bot.id)?.unread);
  useEffect(() => {
    if (unread) void botsApi.read(bot.id).catch(() => undefined);
  }, [unread, bot.id]);

  const messages = chat?.messages ?? [];
  const pending = chat?.pending ?? [];
  const busy = chat?.busy ?? false;
  const modelKnown = models.some((m) => m.id === bot.modelId);
  const modelName = models.find((m) => m.id === bot.modelId)?.name ?? bot.modelId;
  const canSend = gatewayConfigured && modelKnown && !busy && text.trim().length > 0;

  // Keep the transcript pinned to the bottom while streaming, unless the
  // user scrolled up.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const onScroll = () => {
    const el = transcriptRef.current;
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

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
            {busy ? <span className="text-primary">typing…</span> : modelName}
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

      {/* Transcript */}
      <div
        ref={transcriptRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 md:px-4"
      >
        {messages.map((message) => (
          <ChatMessageView
            key={message.id}
            message={message}
            botName={bot.name}
            botEmoji={bot.avatarEmoji}
            botColor={bot.avatarColor}
          />
        ))}
        {pending.map((p) => (
          <ChatMessageView
            key={p.id}
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
        ))}
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
      </div>

      {/* Composer */}
      <div className="border-t px-3 py-3 md:px-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
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
            className="max-h-40 min-h-9 resize-none"
            disabled={!gatewayConfigured || !modelKnown}
          />
          {busy ? (
            <Button variant="outline" size="icon" onClick={stop} aria-label="Stop generating">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={send} disabled={!canSend} aria-label="Send message">
              <SendHorizonal className="size-4" />
            </Button>
          )}
        </div>
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
