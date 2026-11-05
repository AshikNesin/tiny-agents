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
import { botsApi, type Bot, type ModelInfo } from "../lib/bots-api";
import {
  activeMentionToken,
  mentionableBots,
  resolveMentions,
  trackPickedMentions,
  type PickedMention,
} from "../lib/mentions";
import { useBotsStore } from "../store/bots";
import type { OwnerSendOutcome, OwnerSubmission } from "../store/chats";
import { StagedAttachment, type StagedItem, humanSize } from "./Attachments";
import {
  MentionAutocomplete,
  type MentionAutocompleteHandle,
  type MentionableBot,
} from "./MentionAutocomplete";
import { Spinner } from "./ui/spinner";
import { SearchSelect, type SearchSelectOption } from "./ui/search-select";
import { errorMessage } from "../lib/errors";

/** Most attachments one message can carry. */
const MAX_ATTACHMENTS = 10;
const MENTION_TIP_KEY = "tiny-agents:mention-tip-seen";
/** The server's per-file limit (uploads.routes.ts MAX_UPLOAD_MB), checked before uploading. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const ACCEPTED_FILES =
  "image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.md,.json,.csv,.yaml,.yml,.xml,.html,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.zip,.tar,.gz,.tgz,.bz2,.7z,.rar,.mp3,.wav,.ogg,.m4a,.mp4,.webm,.mov,.tsv,.log,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.go,.rs,.java,.kt,.rb,.php,.sh,.sql,.toml,.ini,.cfg,.diff,.patch,.css,.c,.h,.cpp,.swift";

/**
 * Primary-pointer media query (pointer: coarse = touch, e.g. phones and
 * tablets). On such devices Enter inserts a newline and only the send
 * button sends — Enter-to-send is a physical-keyboard affordance (issue #1).
 */
function prefersCoarsePointer(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Unsent text survives switching bots and reloads (per bot, this browser
 * only). Storage can be unavailable (private mode, blocked site data), so
 * every access is best-effort.
 */
const draftKey = (botId: string) => `tiny-agents:draft:${botId}`;

function readDraft(botId: string): string {
  try {
    return localStorage.getItem(draftKey(botId)) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(botId: string, text: string) {
  try {
    if (text) localStorage.setItem(draftKey(botId), text);
    else localStorage.removeItem(draftKey(botId));
  } catch {
    // Drafts are a convenience; losing one is fine.
  }
}

/** The hint shown instead of sending when a typed @name fits several bots. */
function ambiguousMentionHint(names: string[]): string {
  const quoted = names.map((name) => `"${name}"`).join(", ");
  return `More than one bot is named ${quoted}. Type @ and pick the one you mean from the list.`;
}

export interface ChatComposerHandle {
  /** Stage files from outside the composer (drag and drop on the pane). */
  stageFiles: (files: FileList | File[]) => void;
}

interface ChatComposerProps {
  bot: Bot;
  model: ModelInfo | undefined;
  /** The catalog, for the model chip. */
  models?: ModelInfo[];
  /** Switch the bot's model from the chip; leave out to show it read-only (a guest). */
  onModelChange?: (modelId: string) => Promise<void> | void;
  gatewayConfigured: boolean;
  busy: boolean;
  /**
   * Send one owner message (store/chats.ts). "restored": it was refused
   * and its Echo withdrawn, so the composer puts the draft back.
   */
  onSend: (submission: OwnerSubmission) => Promise<OwnerSendOutcome>;
  onStop: () => Promise<void>;
  onEditBot: () => void;
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * The model chip in the composer's toolbar, as on the Code page: a
 * searchable picker that saves the bot's model.
 */
function ModelChip({
  models,
  value,
  onChange,
}: {
  models: ModelInfo[];
  value: string;
  onChange?: (modelId: string) => Promise<void> | void;
}) {
  const current = models.find((m) => m.id === value);
  const options: SearchSelectOption[] = models.map((m) => ({
    value: m.id,
    label: m.name,
    group: m.provider,
    description: [m.contextWindow ? `${formatContext(m.contextWindow)} context` : undefined, m.note]
      .filter(Boolean)
      .join(" · "),
    keywords: [m.id, m.family],
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
      value={value}
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

/**
 * The composer, styled after the Code page's: one Fluid InputMessage frame
 * holding the textarea and a toolbar — "+" (files, mention a bot), the
 * model chip, Queue while a reply runs, and one round button that is Stop
 * while the bot replies with nothing typed, and Send (steer) otherwise.
 */
export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
  { bot, model, models = [], onModelChange, gatewayConfigured, busy, onSend, onStop, onEditBot },
  ref,
) {
  const [text, setText] = useState(() => readDraft(bot.id));
  // Mentions picked from the autocomplete, kept in step with the text: they
  // send to the bot picked, not whichever bot the name matches (issue #80).
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const [mentionHint, setMentionHint] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [mentionClosed, setMentionClosed] = useState(false);
  const [staged, setStaged] = useState<StagedItem[]>([]);
  const [stopRequested, setStopRequested] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Where the caret goes once the text that was just set is rendered. */
  const pendingCaret = useRef<number | null>(null);
  const mentionRef = useRef<MentionAutocompleteHandle>(null);
  const pasteCount = useRef(0);
  const coarsePointer = useMemo(prefersCoarsePointer, []);
  const reduceMotion = useReducedMotion() ?? false;

  const roster = useBotsStore((s) => s.bots);
  const mentionCandidates = useMemo(() => mentionableBots(roster, bot.id), [roster, bot.id]);
  // The @ tip lives under the composer (not in the placeholder, where a long
  // bot name wrapped it onto two lines) until the owner has used a mention.
  const [mentionTipSeen, setMentionTipSeen] = useState(() => {
    try {
      return window.localStorage.getItem(MENTION_TIP_KEY) === "1";
    } catch {
      return true;
    }
  });
  const mentionTip = !mentionTipSeen && mentionCandidates.length > 0;
  useEffect(() => {
    if (mentionTipSeen || !text.includes("@")) return;
    setMentionTipSeen(true);
    try {
      window.localStorage.setItem(MENTION_TIP_KEY, "1");
    } catch {
      // Storage blocked: the tip just shows again next time.
    }
  }, [text, mentionTipSeen]);
  // The overlay follows the caret inside the mention token, so it needs
  // the caret on every keystroke; `mentionClosed` covers Escape.
  const mention = activeMentionToken(text, caret);
  const mentionOpen = mention !== null && !mentionClosed;

  const modelKnown = model !== undefined;
  const enabled = gatewayConfigured && modelKnown;
  const uploading = staged.some((item) => item.status === "uploading");
  const readyAttachments = staged.filter((item) => item.status === "done" && item.ref);
  const canSend = enabled && !uploading && (text.trim().length > 0 || readyAttachments.length > 0);
  // Busy no longer blocks sending (steering, issue #9): the server queues
  // the message. Whenever there is nothing sendable (nothing typed, or an
  // attachment still uploading) the same button stops the reply, so the
  // composer never shows two competing round buttons and Stop is never
  // hidden behind a disabled Send.
  const showStop = busy && !canSend;
  // The stop spinner lasts until the server confirms the run ended: a
  // request left over from an earlier run means nothing once busy drops.
  const stopping = stopRequested && busy;

  useEffect(() => writeDraft(bot.id, text), [bot.id, text]);

  // Object URLs pin their files in memory; release whatever is still staged
  // when the composer goes away (switching bots with an image attached).
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

  // Land in the composer when a chat opens, on a physical keyboard only:
  // on touch, focusing would pop the on-screen keyboard over the chat.
  useEffect(() => {
    if (!coarsePointer && enabled) textareaRef.current?.focus({ preventScroll: true });
  }, [coarsePointer, enabled]);

  const stageFiles = (files: FileList | File[]) => {
    const limit = MAX_ATTACHMENTS - staged.length;
    if (limit <= 0) {
      toast.error(`Up to ${MAX_ATTACHMENTS} attachments per message`);
      return;
    }
    for (const file of Array.from(files).slice(0, limit)) {
      const key = crypto.randomUUID();
      const isImage = file.type.startsWith("image/");
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
      const name = file.name || `pasted-image-${++pasteCount.current}.png`;
      if (file.size > MAX_UPLOAD_BYTES) {
        const error = `${name} is ${humanSize(file.size)}; files can be up to 25 MB.`;
        setStaged((current) => [...current, { key, name, status: "error", error, previewUrl }]);
        toast.error(error);
        continue;
      }
      setStaged((current) => [...current, { key, name, status: "uploading", previewUrl }]);
      botsApi
        .upload(new File([file], name, { type: file.type || "application/octet-stream" }))
        .then(({ ref }) => {
          // Removed (or sent without it) while uploading: nothing will ever
          // reference this upload, so delete it instead of leaking it.
          if (!stagedRef.current.some((item) => item.key === key)) {
            void botsApi.deleteUpload(ref.uploadId).catch(() => undefined);
            return;
          }
          setStaged((current) =>
            current.map((item) => (item.key === key ? { ...item, status: "done", ref } : item)),
          );
        })
        .catch((error) => {
          const message = errorMessage(error, "Upload failed");
          // The 64px tile has no room for the reason; say it once, readably.
          toast.error(`${name}: ${message}`);
          setStaged((current) =>
            current.map((item) =>
              item.key === key ? { ...item, status: "error", error: message } : item,
            ),
          );
        });
    }
    textareaRef.current?.focus({ preventScroll: true });
  };

  useImperativeHandle(ref, () => ({ stageFiles }));

  const unstage = (item: StagedItem) => {
    setStaged((current) => current.filter((candidate) => candidate.key !== item.key));
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.ref) void botsApi.deleteUpload(item.ref.uploadId).catch(() => undefined);
  };

  const send = async (whenBusy: "steer" | "followUp" = "steer") => {
    if (!canSend) return;
    const body = text.trim();
    // Picks are placed in `text`; trimming moves them left by the indent.
    const indent = text.length - text.trimStart().length;
    const bodyPicked = picked.map((pick) => ({ ...pick, start: pick.start - indent }));
    const mentions = resolveMentions(body, mentionCandidates, bot.id, bodyPicked);
    // A typed name several bots share would reach an arbitrary one of them.
    if (mentions.ambiguous.length > 0) {
      setMentionHint(ambiguousMentionHint(mentions.ambiguous));
      return;
    }
    const attachments = readyAttachments.map((item) => item.ref!);
    setText("");
    setPicked([]);
    setStaged([]);
    setMentionClosed(false);
    for (const item of staged) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    // An offline send stays an Echo and goes again by itself once the
    // browser is back (store/chats.ts); only a refusal comes back here.
    const outcome = await onSend({
      body,
      attachments,
      mentions: mentions.ids,
      whenBusy,
    }).catch((): OwnerSendOutcome => "restored");
    if (outcome === "restored") {
      // The send was refused (and toasted); hand the message back for another
      // try, ahead of anything typed or attached while the send was in flight.
      setText((current) => (current.trim() ? `${body}\n\n${current}` : body));
      // Picks made meanwhile imply text, so they move down behind the body.
      setPicked((current) => [
        ...bodyPicked,
        ...current.map((pick) => ({ ...pick, start: pick.start + body.length + 2 })),
      ]);
      setStaged((current) => [
        ...attachments.map((ref) => ({
          key: crypto.randomUUID(),
          name: ref.name,
          status: "done" as const,
          ref,
          previewUrl: ref.kind === "image" ? botsApi.uploadUrl(ref.uploadId) : undefined,
        })),
        ...current,
      ]);
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
    const insertion = `@${chosen.name} `;
    const next = text.slice(0, mention.start) + insertion + text.slice(caret);
    setText(next);
    // The latest pick at this `@` replaces any earlier one there.
    setPicked((current) => [
      ...trackPickedMentions(text, next, current).filter((pick) => pick.start !== mention.start),
      { start: mention.start, botId: chosen.id, name: chosen.name },
    ]);
    setMentionHint(null);
    // Restore the caret after the trailing space once React re-renders the
    // textarea (it would otherwise land at the very end of the text).
    const target = mention.start + insertion.length;
    setCaret(target);
    pendingCaret.current = target;
  };

  /** "+" → Mention a bot: type an `@` at the caret, which opens the picker. */
  const startMention = () => {
    const el = textareaRef.current;
    const at = el?.selectionStart ?? text.length;
    const before = text.slice(0, at);
    const insertion = before && !/\s$/.test(before) ? " @" : "@";
    setText(before + insertion + text.slice(at));
    const target = at + insertion.length;
    setCaret(target);
    setMentionClosed(false);
    pendingCaret.current = target;
    requestAnimationFrame(() => el?.focus({ preventScroll: true }));
  };

  // Place the caret in the same commit that renders the inserted mention: a
  // frame later it would race the owner's next keystrokes and jump back
  // mid-word.
  useLayoutEffect(() => {
    const target = pendingCaret.current;
    if (target === null || !textareaRef.current) return;
    pendingCaret.current = null;
    textareaRef.current.selectionStart = target;
    textareaRef.current.selectionEnd = target;
  }, [text]);

  // Pressing a round button must not steal focus from the textarea: on
  // desktop the caret stays put for the next message, on touch the
  // on-screen keyboard does not collapse and reopen on every send.
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  return (
    <div
      data-slot="chat-composer"
      // A physical keyboard gets a taller bottom gutter that holds the
      // keyboard hint line, so the composer never moves when it appears.
      className={`px-3 pt-2 md:px-4 ${
        coarsePointer
          ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          : "pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      }`}
    >
      {gatewayConfigured && !modelKnown && (
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
        {/* Fluid InputMessage frame: a hairline ring (not a border) that gains
            contrast on hover and focus, over a soft drop shadow; clicking the
            frame's padding focuses the field. */}
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
              setPicked((current) => trackPickedMentions(text, next, current));
              setText(next);
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
              // Escape stops a running reply from the keyboard.
              if (e.key === "Escape" && busy) {
                e.preventDefault();
                void stop();
                return;
              }
              // Enter sends only on a physical keyboard (fine pointer).
              // On touch (pointer: coarse) Enter inserts a newline and the
              // send button is the only way to send (issue #1). While a
              // reply runs, Enter steers it and Alt+Enter queues a
              // follow-up for afterwards (issue #9). IME composition
              // (CJK input) uses Enter to commit a candidate, not to send.
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
              <DropdownMenuContent align="start" side="top" className="w-64">
                <DropdownMenuItem
                  disabled={staged.length >= MAX_ATTACHMENTS}
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
                <ModelChip models={models} value={bot.modelId} onChange={onModelChange} />
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
              {/* One button that changes job: send/steer, or stop while a
                  reply runs; the icon pops between the two (Fluid InputMessage). */}
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
        {/* Keyboard hints while a reply runs: one quiet line under the
            pill, fading in and out inside the reserved gutter. */}
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
