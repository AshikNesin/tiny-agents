import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUp,
  File,
  Folder,
  ListPlus,
  Paperclip,
  Plus,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { Button, monoClass } from "@groot/ui";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { cn } from "@groot/ui/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Spinner } from "../../components/ui/spinner";
import { useNextMessage, type LastTurn } from "./use-next-message";
import { Kbd } from "../../components/keys";
import { errorMessage } from "../../lib/errors";
import { codeApi, type HarnessInfo, type Skill } from "../../lib/code/api";
import { RESOURCE_QUERY, wait } from "../../queries/resource";
import {
  canSend as draftCanSend,
  editText,
  emptyDraft,
  hasContent,
  outgoing,
  withStaged,
  type ComposerDraft,
} from "../../lib/composer-draft";
import {
  codeDraftKey,
  prefersCoarsePointer,
  readStoredDraft,
  writeStoredDraft,
} from "../../lib/composer-browser";
import { canStageMore, stageUploads, unstageUpload, type Staging } from "../../lib/staged-uploads";

function tokenAt(
  text: string,
  cursor: number,
): { kind: "@" | "/"; start: number; query: string } | undefined {
  const before = text.slice(0, cursor);
  const at = /(^|\s)@([^\s@]*)$/.exec(before);
  if (at) return { kind: "@", start: cursor - at[2].length - 1, query: at[2] };
  const slash = /^\/([a-z-]*)$/.exec(before);
  if (slash) return { kind: "/", start: 0, query: slash[1] };
  return undefined;
}

function quoteRef(path: string): string {
  return /[\s,:()"]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
}

export interface ComposerProps {
  draftKey: string;
  harness: HarnessInfo;
  cwd?: string | null;
  threadId?: string;
  working?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  insert?: { text: string; nonce: number } | null;
  controls?: React.ReactNode;
  onStop?(): void;
  hint?: string;
  submitLabel?: string;
  lastTurn?: LastTurn | null;
  onSend(
    message: string,
    options: { queue: boolean; skills: string[]; attachments: string[] },
  ): Promise<void>;
}

export function Composer({
  draftKey,
  harness,
  cwd,
  threadId,
  working = false,
  placeholder,
  autoFocus,
  insert,
  controls,
  onStop,
  hint,
  submitLabel,
  lastTurn = null,
  onSend,
}: ComposerProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const caps = harness.capabilities;
  const canUpload = caps.workspace.uploads;
  const canFind = caps.workspace.findFiles;
  const canSkills = caps.workspace.skills;
  const canQueue = caps.turns.queue;
  const steers = caps.turns.steer;
  const commands = harness.commands;
  const name = harness.label;
  const [draft, setDraft] = useState<ComposerDraft<string>>(() =>
    emptyDraft(readStoredDraft(codeDraftKey(draftKey))),
  );
  const { text, staged: attachments } = draft;
  const [sending, setSending] = useState(false);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<
    Array<{ value: string; label: string; detail?: string; dir?: boolean }>
  >([]);
  const [active, setActive] = useState(0);
  const [token, setToken] = useState<ReturnType<typeof tokenAt>>();
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(blurTimer.current), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const next = useNextMessage(threadId, working ? null : lastTurn, text);

  useEffect(() => {
    setDraft(emptyDraft(readStoredDraft(codeDraftKey(draftKey))));
    setSelectedSkills([]);
  }, [draftKey]);
  useEffect(() => writeStoredDraft(codeDraftKey(draftKey), text), [draftKey, text]);

  useEffect(() => {
    if (!insert) return;
    setDraft((prev) =>
      editText(prev, prev.text.trim() ? `${prev.text.trimEnd()}\n${insert.text}` : insert.text),
    );
    requestAnimationFrame(() => {
      area.current?.focus();
      const end = area.current?.value.length ?? 0;
      area.current?.setSelectionRange(end, end);
    });
  }, [insert]);

  useEffect(() => {
    if (!token) {
      setSuggestions([]);
      return;
    }
    if (token.kind === "/") {
      setSuggestions(
        commands
          .filter((c) => c.command.slice(1).startsWith(token.query))
          .map((c) => ({
            value: c.command,
            label: c.command,
            detail: c.hint,
          })),
      );
      setActive(0);
      return;
    }
    if (!cwd || !canFind) {
      setSuggestions([]);
      return;
    }
  }, [token, cwd, canFind, commands]);
  const fileQuery = token && token.kind !== "/" && cwd && canFind ? token.query : null;
  const files = useQuery({
    queryKey: ["code", "find-files", harness.id, cwd, fileQuery],
    queryFn: async ({ signal }) => {
      await wait(120, signal);
      return codeApi
        .findFiles(harness.id, cwd!, fileQuery!)
        .then((matches) =>
          matches.slice(0, 12).map((m) => ({ value: m.path, label: m.path, dir: m.isDir })),
        )
        .catch(() => []);
    },
    enabled: fileQuery !== null,
    placeholderData: keepPreviousData,
    structuralSharing: false,
    ...RESOURCE_QUERY,
  });
  useEffect(() => {
    if (fileQuery === null || !files.data || files.isPlaceholderData) return;
    setSuggestions(files.data);
    setActive(0);
  }, [fileQuery, files.data, files.isPlaceholderData]);

  const loadSkills = useCallback(() => {
    if (skills || !cwd || !canSkills) return;
    codeApi
      .skills(harness.id, cwd, threadId)
      .then((r) => setSkills(Array.isArray(r) ? r : []))
      .catch(() => setSkills([]));
  }, [skills, cwd, canSkills, harness.id, threadId]);

  const stagedRef = useRef(attachments);
  useEffect(() => {
    stagedRef.current = attachments;
  }, [attachments]);
  const staging: Staging<string> = {
    upload: (file) => codeApi.upload(harness.id, file),
    current: () => stagedRef.current,
    update: (change) => setDraft((current) => withStaged(current, change)),
    notify: (message) => toast.error(message),
  };

  const upload = (files: FileList | File[]) => {
    if (canUpload) void stageUploads(files, staging);
  };

  const canSend = draftCanSend(draft) && !sending;

  const send = async (queue: boolean) => {
    if (!canSend) return;
    const sent = outgoing(draft);
    setSending(true);
    try {
      await onSend(sent.body || "(see the attached files)", {
        queue: queue || (working && !steers && canQueue),
        skills: selectedSkills,
        attachments: sent.attachments,
      });
      setDraft(emptyDraft());
      setSelectedSkills([]);
      writeStoredDraft(codeDraftKey(draftKey), "");
    } catch (error) {
      toast.error(errorMessage(error, "Could not send the message."));
    } finally {
      setSending(false);
    }
  };

  const choose = (index: number) => {
    const pick = suggestions[index];
    if (!pick || !token) return;
    const cursor = area.current?.selectionStart ?? text.length;
    const replacement =
      token.kind === "/" ? `${pick.value} ` : `@${quoteRef(pick.value)}${pick.dir ? "" : " "}`;
    const next = text.slice(0, token.start) + replacement + text.slice(cursor);
    setDraft((current) => editText(current, next));
    setToken(undefined);
    requestAnimationFrame(() => {
      const pos = token.start + replacement.length;
      area.current?.setSelectionRange(pos, pos);
      area.current?.focus();
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((i) => (i + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        choose(active);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setToken(undefined);
        return;
      }
    }
    if (event.key === "Tab" && !event.shiftKey && next.full) {
      event.preventDefault();
      const full = next.full;
      setDraft((current) => editText(current, full));
      requestAnimationFrame(() => area.current?.setSelectionRange(full.length, full.length));
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !prefersCoarsePointer()) {
      event.preventDefault();
      void send(event.altKey && working && canQueue);
    }
  };

  const updateToken = (value: string, cursor: number) => setToken(tokenAt(value, cursor));

  const showStop = working && !hasContent(draft) && Boolean(onStop);

  return (
    <div
      className="relative"
      onDragOver={(e) => {
        if (canUpload && e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
    >
      {suggestions.length > 0 && (
        <div
          role="listbox"
          aria-label={token?.kind === "/" ? "Commands" : "Files"}
          className="bg-popover text-popover-foreground absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full max-w-xl overflow-y-auto rounded-xl p-1 shadow-md ring-1 ring-foreground/10"
        >
          {suggestions.map((s, i) => (
            <button
              key={s.value}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                i === active ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
            >
              {token?.kind === "@" ? (
                s.dir ? (
                  <Folder className="size-4 shrink-0" />
                ) : (
                  <File className="size-4 shrink-0" />
                )
              ) : null}
              <span className={cn("shrink-0 truncate", monoClass)}>{s.label}</span>
              {s.detail && (
                <span className="text-muted-foreground min-w-0 truncate text-xs">{s.detail}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {(attachments.length > 0 || selectedSkills.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5 px-1" data-testid="code-composer-chips">
          {selectedSkills.map((name) => (
            <Chip
              key={name}
              icon={<Sparkles className="size-3" />}
              label={name}
              onRemove={() => setSelectedSkills((prev) => prev.filter((n) => n !== name))}
              removeLabel={`Remove skill ${name}`}
            />
          ))}
          {attachments.map((a) => (
            <Chip
              key={a.key}
              icon={
                a.status === "uploading" ? (
                  <Spinner className="size-3" />
                ) : (
                  <Paperclip className="size-3" />
                )
              }
              label={a.name}
              tone={a.status === "error" ? "destructive" : undefined}
              onRemove={() => unstageUpload(a, staging)}
              removeLabel={`Remove ${a.name}`}
            />
          ))}
        </div>
      )}

      <div
        data-slot="composer-frame"
        className={cn(
          "bg-composer relative flex cursor-text flex-col gap-1 rounded-3xl p-2",
          "shadow-[0_0_0_1px_var(--border),0_1px_2px_-1px_rgb(0_0_0/0.06),0_4px_12px_-4px_rgb(0_0_0/0.08)]",
          "hover:shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_18%,transparent),0_1px_2px_-1px_rgb(0_0_0/0.06),0_4px_12px_-4px_rgb(0_0_0/0.08)]",
          "focus-within:shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_32%,transparent),0_1px_2px_-1px_rgb(0_0_0/0.06),0_4px_12px_-4px_rgb(0_0_0/0.08)]",
          dragging &&
            "shadow-[0_0_0_2px_color-mix(in_oklab,var(--foreground)_45%,transparent)] hover:shadow-[0_0_0_2px_color-mix(in_oklab,var(--foreground)_45%,transparent)]",
        )}
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          area.current?.focus();
        }}
      >
        <div className="relative">
          {next.ghost && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden px-2 pt-1.5 text-base leading-7 break-words whitespace-pre-wrap md:text-sm md:leading-6"
            >
              <span className="invisible">{text}</span>
              <span className="text-fg-tertiary" data-testid="code-composer-suggestion">
                {next.ghost}
              </span>
              <Kbd keys="Tab" className="ml-2 align-middle opacity-70" />
            </div>
          )}
          <textarea
            ref={area}
            autoFocus={autoFocus}
            value={text}
            rows={1}
            placeholder={
              next.ghost && !text
                ? ""
                : dragging
                  ? "Drop files to attach them"
                  : (placeholder ??
                    (working
                      ? steers
                        ? `Steer ${name}: goes into the running turn`
                        : `Message ${name}: sent when this turn ends`
                      : "Send a message…"))
            }
            onChange={(e) => {
              setDraft((current) => editText(current, e.target.value));
              updateToken(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => updateToken(e.currentTarget.value, e.currentTarget.selectionStart)}
            onBlur={() => {
              blurTimer.current = setTimeout(() => setToken(undefined), 100);
            }}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length && canUpload) {
                e.preventDefault();
                upload(files);
              }
            }}
            className="placeholder:text-fg-tertiary field-sizing-content max-h-60 min-h-[2.75rem] w-full resize-none overflow-y-auto bg-transparent px-2 pt-1.5 text-base leading-7 outline-none md:text-sm md:leading-6"
            data-testid="code-composer"
            aria-label={`Message ${name}`}
          />
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) upload(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="flex min-w-0 items-center gap-1">
          {(canUpload || canSkills) && (
            <DropdownMenu onOpenChange={(open) => open && loadSkills()}>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Add files or skills"
                    title="Add files or skills"
                    className={cn(
                      "text-muted-foreground shrink-0 rounded-full",
                      selectedSkills.length > 0 && "text-foreground",
                    )}
                    data-testid="code-composer-add"
                  />
                }
              >
                <Plus />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="max-h-96 w-72">
                {canUpload && (
                  <DropdownMenuItem
                    disabled={!canStageMore(attachments)}
                    onSelect={() => fileInput.current?.click()}
                  >
                    <Paperclip />
                    Add files or images
                    <span className="text-muted-foreground ml-auto text-xs">paste · drop</span>
                  </DropdownMenuItem>
                )}
                {cwd && canSkills && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                      Skills for this message
                    </DropdownMenuLabel>
                    {skills === null ? (
                      <div className="flex justify-center p-2">
                        <Spinner />
                      </div>
                    ) : skills.length === 0 ? (
                      <p className="text-muted-foreground px-2 pb-2 text-xs">
                        No skills in this directory.
                      </p>
                    ) : (
                      skills.map((skill) => (
                        <DropdownMenuCheckboxItem
                          key={skill.name}
                          checked={selectedSkills.includes(skill.name)}
                          onSelect={(e) => e.preventDefault()}
                          onCheckedChange={(checked) =>
                            setSelectedSkills((prev) =>
                              checked
                                ? [...prev, skill.name]
                                : prev.filter((n) => n !== skill.name),
                            )
                          }
                        >
                          <Sparkles className="text-muted-foreground" />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">{skill.name}</span>
                            {skill.description && (
                              <span className="text-muted-foreground line-clamp-2 text-xs">
                                {skill.description}
                              </span>
                            )}
                          </span>
                        </DropdownMenuCheckboxItem>
                      ))
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="@container flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
            {controls}
          </div>
          {working && !showStop && canQueue && steers && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground shrink-0 rounded-full"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void send(true)}
              disabled={!canSend}
              aria-label="Queue for when this turn ends"
              title="Queue for when this turn ends (Alt+Enter)"
              data-testid="code-queue"
            >
              <ListPlus />
            </Button>
          )}
          <Button
            size="icon"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (showStop ? onStop?.() : void send(false))}
            disabled={showStop ? false : !canSend}
            data-testid={showStop ? "code-stop" : "code-send"}
            aria-label={
              showStop ? `Stop ${name}` : (submitLabel ?? (working && steers ? "Steer" : "Send"))
            }
            title={
              showStop
                ? "Stop (⌘.)"
                : working && steers
                  ? "Steer the running turn (Enter)"
                  : `${submitLabel ?? "Send"} (Enter)`
            }
            className="size-8 shrink-0 rounded-full disabled:opacity-30"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={showStop ? "stop" : sending ? "sending" : "send"}
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
                  <Square className="size-3 fill-current" />
                ) : sending ? (
                  <Spinner className="size-4" aria-hidden />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </motion.span>
            </AnimatePresence>
          </Button>
        </div>
      </div>
      {(working || hint) && (
        <p
          className="text-muted-foreground mt-1.5 truncate text-center text-[11px] leading-4 pointer-coarse:hidden"
          data-testid="code-composer-hint"
        >
          {working
            ? steers
              ? `Enter steers${canQueue ? " · Alt+Enter queues" : ""} · Esc stops`
              : "Enter queues for the end of this turn · Esc stops"
            : hint}
        </p>
      )}
    </div>
  );
}

function Chip({
  icon,
  label,
  tone,
  onRemove,
  removeLabel,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "destructive";
  onRemove(): void;
  removeLabel: string;
}) {
  return (
    <span
      className={cn(
        "bg-muted flex items-center gap-1 rounded-full py-0.5 pr-0.5 pl-2 text-xs",
        tone === "destructive" && "text-destructive",
      )}
    >
      {icon}
      <span className="max-w-40 truncate">{label}</span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="text-muted-foreground hover:bg-background hover:text-foreground rounded-full p-0.5"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
