/**
 * The Code page composer (issue #143), Shelley's composer features through
 * its API: `@` file and folder completion in the working directory
 * (`/find-files`), `/` command hints (Shelley interprets the commands),
 * pasted or dropped attachments (`/upload/raw`, referenced as `[path]`),
 * skills, and a draft kept per conversation.
 *
 * Enter sends; while Shelley works, Enter steers the running turn and
 * "Queue" (or Alt+Enter) holds the message for when the turn ends.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { File, Folder, ListPlus, Paperclip, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button, monoClass } from "@groot/ui";
import { Textarea } from "@groot/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { shelleyApi, type FindFilesMatch, type Skill } from "../../lib/shelley/api";

const SLASH_COMMANDS: Array<{ command: string; hint: string }> = [
  { command: "/model", hint: "Show or switch the model and reasoning (e.g. /model sonnet high)" },
  { command: "/compact", hint: "Compact the context to free room" },
  { command: "/btw", hint: "Ask a side question without disturbing the turn" },
  { command: "/fork", hint: "Continue in a copy of this conversation" },
  { command: "/cwd", hint: "Change the working directory" },
  { command: "/new", hint: "Start a new conversation" },
  { command: "/help", hint: "List Shelley's commands" },
];

const DRAFT_PREFIX = "tiny-agents:shelley-draft:";

function readDraft(key: string): string {
  try {
    return window.localStorage.getItem(DRAFT_PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string, text: string) {
  try {
    if (text) window.localStorage.setItem(DRAFT_PREFIX + key, text);
    else window.localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // Private mode: the draft just isn't kept.
  }
}

interface Attachment {
  id: string;
  name: string;
  status: "uploading" | "ready" | "error";
  path?: string;
}

/** The `@token` (or `/command` at the start) around the cursor, if any. */
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
  /** Draft key: the conversation id, or "new". */
  draftKey: string;
  cwd?: string | null;
  conversationId?: string;
  working?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Text to add to the draft (a diff comment); consumed once. */
  insert?: { text: string; nonce: number } | null;
  /** Rendered beside the buttons (the new-conversation form's options). */
  footer?: React.ReactNode;
  submitLabel?: string;
  onSend(message: string, options: { queue: boolean; skills: string[] }): Promise<void>;
}

export function Composer({
  draftKey,
  cwd,
  conversationId,
  working = false,
  placeholder,
  autoFocus,
  insert,
  footer,
  submitLabel,
  onSend,
}: ComposerProps) {
  const [text, setText] = useState(() => readDraft(draftKey));
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<
    Array<{ value: string; label: string; detail?: string; dir?: boolean }>
  >([]);
  const [active, setActive] = useState(0);
  const [token, setToken] = useState<ReturnType<typeof tokenAt>>();
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // A new conversation key loads its own draft.
  useEffect(() => {
    setText(readDraft(draftKey));
    setAttachments([]);
    setSelectedSkills([]);
  }, [draftKey]);
  useEffect(() => writeDraft(draftKey, text), [draftKey, text]);

  useEffect(() => {
    if (!insert) return;
    setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${insert.text}` : insert.text));
    requestAnimationFrame(() => {
      area.current?.focus();
      const end = area.current?.value.length ?? 0;
      area.current?.setSelectionRange(end, end);
    });
  }, [insert]);

  // `@` completion: names first, as you type (debounced, cancelled by the next keystroke).
  useEffect(() => {
    if (!token) {
      setSuggestions([]);
      return;
    }
    if (token.kind === "/") {
      setSuggestions(
        SLASH_COMMANDS.filter((c) => c.command.slice(1).startsWith(token.query)).map((c) => ({
          value: c.command,
          label: c.command,
          detail: c.hint,
        })),
      );
      setActive(0);
      return;
    }
    if (!cwd) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      shelleyApi
        .findFiles(cwd, token.query)
        .then((result) => {
          if (cancelled) return;
          const dir = result.search_dir.replace(/\/$/, "");
          const base = cwd.replace(/\/$/, "");
          const prefix =
            dir === base
              ? ""
              : dir.startsWith(`${base}/`)
                ? `${dir.slice(base.length + 1)}/`
                : `${dir}/`;
          setSuggestions(
            result.matches.slice(0, 12).map((m: FindFilesMatch) => ({
              value: `${prefix}${m.path}`,
              label: `${prefix}${m.path}`,
              dir: m.is_dir,
            })),
          );
          setActive(0);
        })
        .catch(() => !cancelled && setSuggestions([]));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, cwd]);

  const loadSkills = useCallback(() => {
    if (skills || !cwd) return;
    shelleyApi
      .skills(cwd, conversationId)
      .then((r) => setSkills(r.skills ?? []))
      .catch(() => setSkills([]));
  }, [skills, cwd, conversationId]);

  const upload = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const id = `${file.name}-${Date.now()}-${Math.random()}`;
      setAttachments((prev) => [
        ...prev,
        { id, name: file.name || "pasted image", status: "uploading" },
      ]);
      shelleyApi
        .upload(file)
        .then((path) =>
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, status: "ready", path } : a)),
          ),
        )
        .catch((error: unknown) => {
          toast.error(errorMessage(error, "Upload failed."));
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "error" } : a)));
        });
    }
  }, []);

  const uploading = attachments.some((a) => a.status === "uploading");
  const ready = attachments.filter((a) => a.status === "ready" && a.path);
  const canSend = (text.trim().length > 0 || ready.length > 0) && !sending && !uploading;

  const send = async (queue: boolean) => {
    if (!canSend) return;
    const tokens = ready.map((a) => `[${a.path}]`).join(" ");
    const message = [text.trim(), tokens].filter(Boolean).join("\n\n");
    setSending(true);
    try {
      await onSend(message, { queue, skills: selectedSkills });
      setText("");
      setAttachments([]);
      setSelectedSkills([]);
      writeDraft(draftKey, "");
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
    setText(next);
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(event.altKey && working);
    }
  };

  const updateToken = (value: string, cursor: number) => setToken(tokenAt(value, cursor));

  const skillMenu = useMemo(
    () =>
      cwd ? (
        <DropdownMenu onOpenChange={(open) => open && loadSkills()}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Skills"
              title="Skills"
              className={cn(selectedSkills.length > 0 && "text-primary")}
            >
              <Sparkles />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
            <DropdownMenuLabel>Skills for this message</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {skills === null ? (
              <div className="p-2">
                <Spinner />
              </div>
            ) : skills.length === 0 ? (
              <p className="text-muted-foreground p-2 text-xs">
                No skills found for this directory.
              </p>
            ) : (
              skills.map((skill) => (
                <DropdownMenuCheckboxItem
                  key={skill.name}
                  checked={selectedSkills.includes(skill.name)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(checked) =>
                    setSelectedSkills((prev) =>
                      checked ? [...prev, skill.name] : prev.filter((n) => n !== skill.name),
                    )
                  }
                >
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
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null,
    [cwd, skills, selectedSkills, loadSkills],
  );

  return (
    <div
      className={cn("relative", dragging && "ring-primary rounded-2xl ring-2")}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
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
          className="bg-popover text-popover-foreground border-border absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full max-w-xl overflow-y-auto rounded-xl border p-1 shadow-lg"
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
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                i === active ? "bg-muted" : "hover:bg-muted",
              )}
            >
              {token?.kind === "@" ? (
                s.dir ? (
                  <Folder className="text-muted-foreground size-4 shrink-0" />
                ) : (
                  <File className="text-muted-foreground size-4 shrink-0" />
                )
              ) : null}
              <span className={cn("truncate", monoClass)}>{s.label}</span>
              {s.detail && (
                <span className="text-muted-foreground truncate text-xs">{s.detail}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {(attachments.length > 0 || selectedSkills.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedSkills.map((name) => (
            <span
              key={name}
              className="bg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 text-xs"
            >
              <Sparkles className="size-3" />
              {name}
              <button
                type="button"
                aria-label={`Remove skill ${name}`}
                onClick={() => setSelectedSkills((prev) => prev.filter((n) => n !== name))}
                className="hover:bg-background rounded-full p-0.5"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {attachments.map((a) => (
            <span
              key={a.id}
              className={cn(
                "bg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 text-xs",
                a.status === "error" && "text-destructive",
              )}
            >
              {a.status === "uploading" ? (
                <Spinner className="size-3" />
              ) : (
                <Paperclip className="size-3" />
              )}
              <span className="max-w-40 truncate">{a.name}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                className="hover:bg-background rounded-full p-0.5"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="bg-background border-border focus-within:ring-ring/50 rounded-2xl border focus-within:ring-2">
        <Textarea
          ref={area}
          autoFocus={autoFocus}
          value={text}
          rows={2}
          placeholder={
            placeholder ??
            (working
              ? "Steer Shelley — goes into the running turn (Alt+Enter queues)"
              : "Message Shelley — @ for files, / for commands")
          }
          onChange={(e) => {
            setText(e.target.value);
            updateToken(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) => updateToken(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => setTimeout(() => setToken(undefined), 100)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              upload(files);
            }
          }}
          className="max-h-60 min-h-0 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          data-testid="code-composer"
          aria-label="Message Shelley"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
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
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => fileInput.current?.click()}
            aria-label="Attach files"
            title="Attach files (or paste / drop)"
          >
            <Paperclip />
          </Button>
          {skillMenu}
          <div className="min-w-0 flex-1">{footer}</div>
          {working && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void send(true)}
              disabled={!canSend}
              title="Queue for when this turn ends (Alt+Enter)"
              data-testid="code-queue"
            >
              <ListPlus />
              Queue
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => void send(false)}
            disabled={!canSend}
            data-testid="code-send"
            title={working ? "Steer the running turn (Enter)" : "Send (Enter)"}
          >
            {sending ? <Spinner /> : <Send />}
            {submitLabel ?? (working ? "Steer" : "Send")}
          </Button>
        </div>
      </div>
    </div>
  );
}
