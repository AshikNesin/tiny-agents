import { UNAVAILABLE_LABEL } from "./ai-elements/ModelSelector";
import {
  forwardRef,
  type MouseEvent,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUp, AtSign, ChevronDown, Cpu, ListPlus, Paperclip, Plus, Square } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@groot/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { cn } from "@groot/ui/lib/utils";
import { toast } from "sonner";
import type { Bot } from "../../shared/api/bots";
import type { CatalogModel } from "../../shared/api/models";
import type { AttachmentRef } from "../lib/chat-types";
import { botsApi } from "../lib/bots-api";
import {
  canSend as draftCanSend,
  editText,
  emptyDraft,
  insertMention as draftInsertMention,
  isNewChatCommand,
  outgoing,
  restoreRefused,
  startMention as draftStartMention,
  withStaged,
  type ComposerDraft,
} from "../lib/composer-draft";
import {
  chatDraftKey,
  markMentionTipSeen,
  mentionTipSeen as readMentionTipSeen,
  prefersCoarsePointer,
  readStoredDraft,
  writeStoredDraft,
} from "../lib/composer-browser";
import { activeMentionToken, mentionableBots, resolveMentions } from "../lib/mentions";
import { canStageMore, stageUploads, unstageUpload, type Staging } from "../lib/staged-uploads";
import { useBotsStore } from "../store/bots";
import type { OwnerSendOutcome, OwnerSubmission } from "../store/chats";
import { StagedAttachment, type StagedItem } from "./Attachments";
import {
  MentionAutocomplete,
  type MentionAutocompleteHandle,
  type MentionableBot,
} from "./MentionAutocomplete";
import { Spinner } from "./ui/spinner";
import { SearchSelect, type SearchSelectOption } from "./ui/search-select";

const ACCEPTED_FILES =
  "image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.md,.json,.csv,.yaml,.yml,.xml,.html,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.zip,.tar,.gz,.tgz,.bz2,.7z,.rar,.mp3,.wav,.ogg,.m4a,.mp4,.webm,.mov,.tsv,.log,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.go,.rs,.java,.kt,.rb,.php,.sh,.sql,.toml,.ini,.cfg,.diff,.patch,.css,.c,.h,.cpp,.swift";

function ambiguousMentionHint(names: string[]): string {
  const quoted = names.map((name) => `"${name}"`).join(", ");
  return `More than one bot is named ${quoted}. Type @ and pick the one you mean from the list.`;
}

export interface ChatComposerHandle {
  stageFiles: (files: FileList | File[]) => void;
  focus: () => void;
  setText: (text: string) => void;
}

interface ChatComposerProps {
  bot: Bot;
  model: CatalogModel | undefined;
  models?: CatalogModel[];
  onModelChange?: (modelId: string) => Promise<void> | void;
  canAnswer: boolean;
  busy: boolean;
  onSend: (submission: OwnerSubmission) => Promise<OwnerSendOutcome>;
  onStop: () => Promise<void>;
  onEditBot: () => void;
  onNewChat?: () => boolean;
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  return `${Math.round(tokens / 1000)}k`;
}

function ModelChip({
  models,
  value,
  onChange,
}: {
  models: CatalogModel[];
  value: string | null;
  onChange?: (modelId: string) => Promise<void> | void;
}) {
  const current = models.find((m) => m.id === value);
  const options: SearchSelectOption[] = models
    .filter((m) => m.enabled || m.id === value)
    .map((m) => ({
      value: m.id,
      label: m.name,
      group: m.providerName,
      description: [
        m.contextWindow ? `${formatContext(m.contextWindow)} context` : undefined,
        m.unavailableReason ? UNAVAILABLE_LABEL[m.unavailableReason] : m.note,
      ]
        .filter(Boolean)
        .join(" · "),
      keywords: [m.upstreamId, m.providerName],
      disabled: !m.available,
    }));
  const label = (
    <>
      <Cpu className="opacity-70" />
      <span className="max-w-28 truncate @xs:max-w-48">{current?.name ?? value}</span>
    </>
  );
  if (!onChange) {
    return (
      <span
        className="text-muted-foreground inline-flex h-7 min-w-0 items-center gap-1 px-2 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0"
        title="Model"
      >
        {label}
      </span>
    );
  }
  return (
    <SearchSelect
      label="Model"
      value={value ?? ""}
      onValueChange={(next) => void onChange(next)}
      options={options}
      searchPlaceholder="Search models…"
      emptyText="No model matches."
      side="top"
      contentClassName="w-80"
      data-testid="chat-model"
    >
      {label}
      <ChevronDown className="opacity-50" />
    </SearchSelect>
  );
}

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
  { bot, model, models = [], onModelChange, canAnswer, busy, onSend, onStop, onEditBot, onNewChat },
  ref,
) {
  const [draft, setDraft] = useState<ComposerDraft<AttachmentRef>>(() =>
    emptyDraft(readStoredDraft(chatDraftKey(bot.id))),
  );
  const { text, staged } = draft;
  const [mentionHint, setMentionHint] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [mentionClosed, setMentionClosed] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const mentionFromMenu = useRef(false);
  const mentionRef = useRef<MentionAutocompleteHandle>(null);
  const coarsePointer = useMemo(prefersCoarsePointer, []);
  const reduceMotion = useReducedMotion() ?? false;

  const roster = useBotsStore((s) => s.bots);
  const mentionCandidates = useMemo(() => mentionableBots(roster, bot.id), [roster, bot.id]);
  const [mentionTipSeen, setMentionTipSeen] = useState(readMentionTipSeen);
  const mentionTip = !mentionTipSeen && mentionCandidates.length > 0;
  useEffect(() => {
    if (mentionTipSeen || !text.includes("@")) return;
    setMentionTipSeen(true);
    markMentionTipSeen();
  }, [text, mentionTipSeen]);
  const mention = activeMentionToken(text, caret);
  const mentionOpen = mention !== null && !mentionClosed;

  const modelKnown = model !== undefined;
  const enabled = canAnswer && modelKnown;
  const canSend = enabled && draftCanSend(draft);
  const showStop = busy && !canSend;
  const stopping = stopRequested && busy;

  useEffect(() => writeStoredDraft(chatDraftKey(bot.id), text), [bot.id, text]);

  const stagedRef = useRef(staged);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);
  useEffect(
    () => () => {
      for (const item of stagedRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    },
    [],
  );

  useEffect(() => {
    if (!coarsePointer && enabled) textareaRef.current?.focus({ preventScroll: true });
  }, [coarsePointer, enabled]);

  const staging: Staging<AttachmentRef> = {
    upload: async (file) => (await botsApi.upload(file)).ref,
    deleteUpload: (ref) => botsApi.deleteUpload(ref.uploadId),
    current: () => stagedRef.current,
    update: (change) => setDraft((current) => withStaged(current, change)),
    notify: (message) => toast.error(message),
    previewUrl: (file) => URL.createObjectURL(file),
    releasePreview: (url) => URL.revokeObjectURL(url),
  };

  const stageFiles = (files: FileList | File[]) => {
    void stageUploads(files, staging);
    textareaRef.current?.focus({ preventScroll: true });
  };

  useImperativeHandle(ref, () => ({
    stageFiles,
    focus: () => textareaRef.current?.focus({ preventScroll: true }),
    setText: (next: string) => {
      setDraft((current) => ({ ...current, text: next }));
      pendingCaret.current = next.length;
      textareaRef.current?.focus({ preventScroll: true });
    },
  }));

  const unstage = (item: StagedItem) => unstageUpload(item, staging);

  const send = async (whenBusy: "steer" | "followUp" = "steer") => {
    if (!canSend) return;
    if (onNewChat && isNewChatCommand(draft)) {
      if (!onNewChat()) return;
      setDraft(emptyDraft());
      setMentionHint(null);
      return;
    }
    const sent = outgoing(draft);
    const mentions = resolveMentions(sent.body, mentionCandidates, bot.id, sent.picked);
    if (mentions.ambiguous.length > 0) {
      setMentionHint(ambiguousMentionHint(mentions.ambiguous));
      return;
    }
    setDraft(emptyDraft());
    setMentionClosed(false);
    for (const item of staged) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    const outcome = await onSend({
      body: sent.body,
      attachments: sent.attachments,
      mentions: mentions.ids,
      whenBusy,
    }).catch((): OwnerSendOutcome => "restored");
    if (outcome === "restored") {
      setDraft((current) =>
        restoreRefused(current, sent, (attachment) => ({
          name: attachment.name,
          previewUrl:
            attachment.kind === "image" ? botsApi.uploadUrl(attachment.uploadId) : undefined,
        })),
      );
      textareaRef.current?.focus({ preventScroll: true });
    }
  };

  const stop = async () => {
    if (!busy || stopping) return;
    setStopRequested(true);
    try {
      await onStop();
    } catch {
      setStopRequested(false);
    }
  };

  const insertMention = (chosen: MentionableBot) => {
    if (!mention) return;
    const next = draftInsertMention(draft, mention, caret, chosen);
    setDraft(next.draft);
    setMentionHint(null);
    setCaret(next.caret);
    pendingCaret.current = next.caret;
  };

  const startMention = () => {
    const el = textareaRef.current;
    const next = draftStartMention(draft, el?.selectionStart ?? text.length);
    setDraft(next.draft);
    setCaret(next.caret);
    setMentionClosed(false);
    pendingCaret.current = next.caret;
    mentionFromMenu.current = true;
    requestAnimationFrame(() => el?.focus({ preventScroll: true }));
  };

  useLayoutEffect(() => {
    const target = pendingCaret.current;
    if (target === null || !textareaRef.current) return;
    pendingCaret.current = null;
    textareaRef.current.selectionStart = target;
    textareaRef.current.selectionEnd = target;
  }, [text]);

  const keepFocus = (e: MouseEvent) => e.preventDefault();

  return (
    <div
      data-slot="chat-composer"
      className={`px-3 pt-2 md:px-4 ${
        coarsePointer
          ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          : "pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      }`}
    >
      {canAnswer && !modelKnown && (
        <div className="mx-auto mb-2 flex max-w-[752px] items-center justify-center gap-2">
          <p className="text-muted-foreground truncate text-center text-xs">
            {bot.modelId} is no longer in the model catalog
          </p>
          <Button variant="link" size="sm" className="h-6 px-1.5 text-xs" onClick={onEditBot}>
            Choose a model
          </Button>
        </div>
      )}
      <div className="relative mx-auto max-w-[752px]">
        {staged.length > 0 && (
          <div className="mb-2 flex flex-wrap justify-end gap-1.5 px-1" data-testid="staged-strip">
            {staged.map((item) => (
              <StagedAttachment key={item.key} attachment={item} onRemove={() => unstage(item)} />
            ))}
          </div>
        )}
        {mentionHint && (
          <p role="alert" className="text-destructive mb-1.5 px-1 text-xs">
            {mentionHint}
          </p>
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
          accept={ACCEPTED_FILES}
          onChange={(e) => {
            if (e.target.files?.length) stageFiles(e.target.files);
            e.target.value = "";
          }}
          aria-label="Attach files"
          data-testid="file-input"
        />
        <div
          data-slot="composer-frame"
          className={cn(
            "bg-composer relative flex flex-col gap-1 overflow-hidden rounded-3xl p-2",
            "shadow-[0_0_0_1px_var(--border),0_1px_2px_-1px_rgb(0_0_0/0.06),0_4px_12px_-4px_rgb(0_0_0/0.08)]",
            "hover:shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_18%,transparent),0_1px_2px_-1px_rgb(0_0_0/0.06),0_4px_12px_-4px_rgb(0_0_0/0.08)]",
            "focus-within:shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_32%,transparent),0_1px_2px_-1px_rgb(0_0_0/0.06),0_4px_12px_-4px_rgb(0_0_0/0.08)]",
            enabled && "cursor-text",
          )}
          onMouseDown={(e) => {
            if (!enabled || e.target !== e.currentTarget) return;
            e.preventDefault();
            textareaRef.current?.focus();
          }}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              const next = e.target.value;
              setDraft((current) => editText(current, next));
              setMentionHint(null);
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
              if (e.key === "Escape" && busy) {
                e.preventDefault();
                void stop();
                return;
              }
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !coarsePointer &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send(e.altKey ? "followUp" : "steer");
              }
            }}
            placeholder={`Message ${bot.name}`}
            rows={1}
            disabled={!enabled}
            className="placeholder:text-fg-tertiary field-sizing-content max-h-60 min-h-[2.75rem] w-full resize-none overflow-y-auto bg-transparent px-2 pt-1.5 text-base leading-7 outline-none disabled:opacity-50 md:text-sm md:leading-6"
          />
          <div className="flex min-w-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!enabled}
                  aria-label="Add files or mention a bot"
                  title="Add files or mention a bot"
                  className="text-muted-foreground shrink-0 rounded-full"
                  data-testid="composer-add"
                >
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="top"
                className="w-64"
                onCloseAutoFocus={(event) => {
                  if (!mentionFromMenu.current) return;
                  mentionFromMenu.current = false;
                  event.preventDefault();
                  textareaRef.current?.focus({ preventScroll: true });
                }}
              >
                <DropdownMenuItem
                  disabled={!canStageMore(staged)}
                  onSelect={() => fileInputRef.current?.click()}
                >
                  <Paperclip />
                  Add files or images
                  <span className="text-muted-foreground ml-auto text-xs">paste · drop</span>
                </DropdownMenuItem>
                {mentionCandidates.length > 0 && (
                  <DropdownMenuItem onSelect={startMention}>
                    <AtSign />
                    Mention a bot
                    <span className="text-muted-foreground ml-auto text-xs">@</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="@container flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
              {models.length > 0 && (
                <ModelChip
                  models={models}
                  value={model?.id ?? bot.modelId}
                  onChange={onModelChange}
                />
              )}
            </div>
            {busy && !showStop && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground shrink-0 rounded-full"
                onMouseDown={keepFocus}
                onClick={() => void send("followUp")}
                disabled={!canSend}
                aria-label="Queue for after this reply"
                title="Queue for after this reply (Alt+Enter)"
                data-testid="composer-queue"
              >
                <ListPlus />
              </Button>
            )}
            <div className="shrink-0">
              <Button
                size="icon"
                onMouseDown={keepFocus}
                onClick={() => void (showStop ? stop() : send("steer"))}
                disabled={showStop ? stopping : !canSend}
                aria-label={
                  showStop
                    ? stopping
                      ? "Stopping"
                      : "Stop generating"
                    : busy
                      ? "Steer the reply"
                      : "Send message"
                }
                title={
                  showStop
                    ? "Stop generating (Esc)"
                    : busy
                      ? "Add to the running reply (Enter)"
                      : undefined
                }
                className="size-8 rounded-full disabled:opacity-30"
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={showStop ? (stopping ? "stopping" : "stop") : "send"}
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={
                      reduceMotion
                        ? { opacity: 0 }
                        : { opacity: 0, scale: 0.6, transition: { duration: 0.06 } }
                    }
                    transition={{ type: "spring", duration: 0.08, bounce: 0 }}
                    className="flex items-center justify-center leading-none"
                  >
                    {showStop ? (
                      stopping ? (
                        <Spinner className="size-4" aria-hidden />
                      ) : (
                        <Square className="size-3 fill-current" />
                      )
                    ) : (
                      <ArrowUp className="size-4" />
                    )}
                  </motion.span>
                </AnimatePresence>
              </Button>
            </div>
          </div>
        </div>
        {!coarsePointer && (
          <p
            aria-hidden={!busy && !mentionTip}
            data-testid="composer-hint"
            className={`text-muted-foreground pointer-events-none absolute inset-x-0 top-full mt-1 truncate text-center text-[11px] leading-4 transition-opacity duration-200 ${
              busy || mentionTip ? "opacity-100" : "opacity-0"
            }`}
          >
            {busy ? "Enter steers · Alt+Enter queues · Esc stops" : "Type @ to tag another bot"}
          </p>
        )}
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
  );
});
