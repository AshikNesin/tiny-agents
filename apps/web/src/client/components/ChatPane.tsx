import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUp,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Square,
  Trash2,
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
import { activeMentionToken, mentionableBots, mentionedBotIds } from "../lib/mentions";
import { useBotsStore } from "../store/bots";
import { BotAvatar } from "./BotAvatar";
import { ChatMessageView, type ToolLabels } from "./ChatMessageView";
import { MessageAttachments, StagedAttachment, type StagedItem } from "./Attachments";
import {
  MentionAutocomplete,
  type MentionAutocompleteHandle,
  type MentionableBot,
} from "./MentionAutocomplete";
import { formatDayDivider } from "../lib/day-divider";
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
  const markRead = useBotsStore((s) => s.markRead);
  const [text, setText] = useState("");
  const [toolLabels, setToolLabels] = useState<ToolLabels>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [caret, setCaret] = useState(0);
  const [mentionClosed, setMentionClosed] = useState(false);
  const [staged, setStaged] = useState<StagedItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteCount = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionRef = useRef<MentionAutocompleteHandle>(null);

  const roster = useBotsStore((s) => s.bots);
  const mentionCandidates = useMemo(() => mentionableBots(roster, bot.id), [roster, bot.id]);
  // The overlay follows the caret inside the mention token, so it needs
  // the caret on every keystroke; `mentionClosed` covers Escape.
  const mention = activeMentionToken(text, caret);
  const mentionOpen = mention !== null && !mentionClosed;

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

  const messages = chat?.messages ?? [];
  const pending = chat?.pending ?? [];
  const busy = chat?.busy ?? false;
  const modelKnown = models.some((m) => m.id === bot.modelId);
  const model = models.find((m) => m.id === bot.modelId);
  const uploading = staged.some((item) => item.status === "uploading");
  const readyAttachments = staged.filter((item) => item.status === "done" && item.ref);
  const canSend =
    gatewayConfigured &&
    modelKnown &&
    !busy &&
    !uploading &&
    (text.trim().length > 0 || readyAttachments.length > 0);

  const stageFiles = (files: FileList | File[]) => {
    const limit = 10 - staged.length;
    if (limit <= 0) {
      toast.error("Up to 10 attachments per message");
      return;
    }
    for (const file of Array.from(files).slice(0, limit)) {
      const key = crypto.randomUUID();
      const isImage = file.type.startsWith("image/");
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
      const name = file.name || `pasted-image-${++pasteCount.current}.png`;
      setStaged((current) => [...current, { key, name, status: "uploading", previewUrl }]);
      botsApi
        .upload(new File([file], name, { type: file.type || "application/octet-stream" }))
        .then(({ ref }) =>
          setStaged((current) =>
            current.map((item) => (item.key === key ? { ...item, status: "done", ref } : item)),
          ),
        )
        .catch((error) => {
          setStaged((current) =>
            current.map((item) =>
              item.key === key
                ? {
                    ...item,
                    status: "error",
                    error: error instanceof Error ? error.message : "Upload failed",
                  }
                : item,
            ),
          );
        });
    }
  };

  const unstage = (item: StagedItem) => {
    setStaged((current) => current.filter((candidate) => candidate.key !== item.key));
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.ref) void botsApi.deleteUpload(item.ref.uploadId).catch(() => undefined);
  };

  const send = async () => {
    const body = text.trim();
    if (!canSend || (!body && readyAttachments.length === 0)) return;
    const attachmentRefs = readyAttachments.map((item) => item.ref!);
    setText("");
    setStaged([]);
    setMentionClosed(false);
    for (const item of staged) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    const mentions = mentionedBotIds(body, mentionCandidates, bot.id);
    // Optimistic echo: show the message immediately; the SSE snapshot/upsert
    // replaces it once the server confirms (store dedupes by text and
    // attachment ids). If the POST fails the echo is withdrawn and the text
    // returns to the composer.
    const echo = {
      id: crypto.randomUUID(),
      text: body,
      createdAt: Date.now(),
      ...(attachmentRefs.length > 0 ? { attachments: attachmentRefs } : {}),
    };
    applyChatEvent(bot.id, { type: "pending-add", message: echo });
    try {
      await botsApi.send(
        bot.id,
        echo.id,
        body,
        mentions,
        attachmentRefs.map((a) => a.uploadId),
      );
    } catch (error) {
      applyChatEvent(bot.id, { type: "pending-remove", id: echo.id });
      toast.error(error instanceof Error ? error.message : "Failed to send");
      setText(body);
      setStaged(
        attachmentRefs.map((ref, i) => ({
          key: crypto.randomUUID(),
          name: ref.name,
          status: "done" as const,
          ref,
          previewUrl: ref.kind === "image" ? botsApi.uploadUrl(ref.uploadId) : undefined,
          ...(i === -1 ? {} : {}),
        })),
      );
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

  const insertMention = (chosen: MentionableBot) => {
    if (!mention) return;
    const insertion = `@${chosen.name} `;
    const next = text.slice(0, mention.start) + insertion + text.slice(caret);
    setText(next);
    // Restore the caret after the trailing space once React re-renders the
    // textarea (it would otherwise land at the very end of the text).
    const target = mention.start + insertion.length;
    setCaret(target);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = target;
        textareaRef.current.selectionEnd = target;
      }
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header - Grok-style: circular back / bot pill (avatar + name) /
          circular ⋯, floating on the transcript with no border. */}
      <header className="flex items-center gap-3 px-3 pt-3 pb-2 md:px-4 md:pt-4">
        <Button
          variant="outline"
          size="icon"
          className="rounded-full"
          onClick={() => navigate("/chats")}
          aria-label="Back to bots"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <button
          type="button"
          onClick={onEditBot}
          className="border-input bg-secondary/40 hover:bg-muted flex h-10 min-w-0 items-center gap-2.5 rounded-full border px-2 py-1 text-left md:px-2.5"
          aria-label={`Edit ${bot.name}`}
        >
          <BotAvatar name={bot.name} className="size-7" />
          <span className="truncate text-[15px] font-semibold">{bot.name}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="ml-auto rounded-full"
              aria-label="Bot menu"
            >
              <MoreHorizontal className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setConfirmReset(true)}>
              <MessageSquarePlus className="size-4" /> New chat
            </DropdownMenuItem>
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
        <div className="text-muted-foreground flex items-center gap-2 px-4 py-1.5 text-xs">
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

      {/* Transcript (AI Elements Chat: Message Scroller keeps the newest
          message pinned unless the reader scrolled up) */}
      <div className="relative min-h-0 flex-1">
        <MessageScrollerProvider>
          <MessageScroller className="h-full">
            <MessageScrollerViewport className="mx-auto w-full max-w-3xl px-4 py-4">
              <MessageScrollerContent className="space-y-3">
                {messages.length === 0 && pending.length === 0 && (
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
                      <MessageScrollerItem
                        messageId={message.id}
                        scrollAnchor={message.role === "user"}
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
                          <MessageScrollerItem key={p.id} messageId={p.id} scrollAnchor>
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
        </MessageScrollerProvider>
      </div>

      {/* Composer - Grok-style: a single rounded pill with the send/stop
          button inside on the right. Status (model, warnings) sits above the
          pill so the input surface stays clean. */}
      <div className="px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-4">
        {gatewayConfigured && !modelKnown && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center justify-center gap-2">
            <p className="text-muted-foreground truncate text-center text-xs">
              {bot.modelId} is no longer in the model catalog
            </p>
            <Button variant="link" size="sm" className="h-6 px-1.5 text-xs" onClick={onEditBot}>
              Choose a model
            </Button>
          </div>
        )}
        <div className="relative mx-auto max-w-3xl">
          {staged.length > 0 && (
            <div
              className="mb-2 flex flex-wrap justify-end gap-1.5 px-1"
              data-testid="staged-strip"
            >
              {staged.map((item) => (
                <StagedAttachment key={item.key} attachment={item} onRemove={() => unstage(item)} />
              ))}
            </div>
          )}
          {staged.some((item) => item.ref?.kind === "image") && model && !model.vision && (
            <p className="text-muted-foreground mb-1.5 px-1 text-right text-xs">
              {model.name} reads images with the see_image tool
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.md,.json,.csv,.yaml,.yml,.xml,.html,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.zip,.tar,.gz,.tgz,.bz2,.7z,.rar,.mp3,.wav,.ogg,.m4a,.mp4,.webm,.mov"
            onChange={(e) => {
              if (e.target.files?.length) stageFiles(e.target.files);
              e.target.value = "";
            }}
            aria-label="Attach files"
            data-testid="file-input"
          />
          <InputGroup className="min-h-12 rounded-[1.75rem] px-2 py-1.5">
            <InputGroupAddon align="inline-start">
              <InputGroupButton
                variant="ghost"
                size="icon-sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={!gatewayConfigured || !modelKnown || staged.length >= 10}
                aria-label="Attach files"
                className="size-8 rounded-full"
              >
                <Paperclip className="size-4" />
              </InputGroupButton>
            </InputGroupAddon>
            <InputGroupTextarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
                setMentionClosed(false);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onClick={() => setMentionClosed(false)}
              onBlur={() => setMentionClosed(true)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData?.files ?? []);
                if (files.length > 0) {
                  e.preventDefault();
                  stageFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (mentionRef.current?.handleKeyDown(e)) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                mentionCandidates.length > 0
                  ? `Message ${bot.name} (type @ to tag another bot)`
                  : `Ask ${bot.name}`
              }
              rows={1}
              disabled={!gatewayConfigured || !modelKnown}
              className="px-3 py-2.5"
            />
            <InputGroupAddon align="inline-end">
              {busy ? (
                <InputGroupButton
                  variant="outline"
                  size="icon-sm"
                  onClick={stop}
                  aria-label="Stop generating"
                  className="size-8 rounded-full"
                >
                  <Square className="size-3.5" />
                </InputGroupButton>
              ) : (
                <InputGroupButton
                  size="icon-sm"
                  onClick={send}
                  disabled={!canSend}
                  aria-label="Send message"
                  className="bg-primary text-primary-foreground size-8 rounded-full disabled:opacity-30"
                >
                  <ArrowUp className="size-4" />
                </InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
          {mentionOpen && mention && (
            <MentionAutocomplete
              ref={mentionRef}
              bots={mentionCandidates}
              query={mention.query}
              onSelect={insertMention}
              onClose={() => setMentionClosed(true)}
            />
          )}
        </div>
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
