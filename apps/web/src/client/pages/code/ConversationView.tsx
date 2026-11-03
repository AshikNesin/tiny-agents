/**
 * One Shelley conversation on the Code page (issue #143): live transcript,
 * header controls (model and reasoning, context, cost, stop), what is running
 * (the turn, background jobs, subagents), queued messages and the composer.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  FileDiff,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Archive,
  ArchiveRestore,
  Play,
  Send,
  Square,
  Trash2,
  X,
  Bot,
  SquareTerminal,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Input, monoClass } from "@groot/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { useConfirm } from "@groot/ui/primitives";
import { cn } from "@groot/ui/lib/utils";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../../components/ui/message-scroller";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import {
  THINKING_LEVELS,
  conversationTitle,
  queuedMessages,
  shelleyApi,
  shortPath,
  type BackgroundJob,
  type ConversationSettings,
  type ShelleyConversation,
  type ShelleyModel,
} from "../../lib/shelley/api";
import { ancestry } from "../../lib/shelley/list";
import { totalCost } from "../../lib/shelley/transcript";
import { useShelleyConversation } from "../../lib/shelley/use-conversation";
import { useShelleyStore } from "../../store/shelley";
import { Composer } from "./Composer";
import { StreamingTail, TranscriptRow, formatCost, type TranscriptActions } from "./Transcript";

let modelsPromise: Promise<ShelleyModel[]> | undefined;
/** Shelley's models, read once per page load. */
export function loadModels(): Promise<ShelleyModel[]> {
  modelsPromise ??= shelleyApi.models().catch((error: unknown) => {
    modelsPromise = undefined;
    throw error;
  });
  return modelsPromise;
}

function PromptDialog({
  open,
  title,
  description,
  initial,
  label,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description?: string;
  initial: string;
  label: string;
  onSubmit(value: string): Promise<void>;
  onOpenChange(open: boolean): void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(initial), [initial, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!value.trim()) return;
            setBusy(true);
            onSubmit(value.trim())
              .then(() => onOpenChange(false))
              .catch((error: unknown) => toast.error(errorMessage(error, "That did not work.")))
              .finally(() => setBusy(false));
          }}
          className="space-y-4"
        >
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            aria-label={title}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !value.trim()}>
              {busy && <Spinner />}
              {label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContextMeter({ used, max, onCompact }: { used: number; max?: number; onCompact(): void }) {
  if (!max || !used) return null;
  const pct = Math.min(100, Math.round((used / max) * 100));
  return (
    <button
      type="button"
      onClick={onCompact}
      title={`${used.toLocaleString()} of ${max.toLocaleString()} tokens. Click to compact.`}
      className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs"
      data-testid="code-context"
    >
      <span className="bg-muted relative h-1.5 w-14 overflow-hidden rounded-full">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            pct > 85 ? "bg-destructive" : pct > 65 ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      {pct}%
    </button>
  );
}

export function ConversationView({
  id,
  rows,
  publicUrl,
  changesOpen,
  onToggleChanges,
  insert,
}: {
  id: string;
  rows: ShelleyConversation[];
  publicUrl: string | null;
  changesOpen: boolean;
  onToggleChanges(): void;
  insert: { text: string; nonce: number } | null;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const state = useShelleyConversation(id);
  const { conversation, working, messages, items } = state;
  const listRow = rows.find((r) => r.conversation_id === id);
  const row = { ...listRow, ...conversation } as ShelleyConversation | undefined;
  const [settings, setSettings] = useState<ConversationSettings | null>(null);
  const [models, setModels] = useState<ShelleyModel[]>([]);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [subagentCost, setSubagentCost] = useState(0);
  const [dialog, setDialog] = useState<"rename" | "cwd" | null>(null);
  const patchList = useShelleyStore((s) => s.patch);

  useEffect(() => {
    void loadModels()
      .then(setModels)
      .catch(() => setModels([]));
  }, []);
  useEffect(() => {
    setSettings(null);
    shelleyApi
      .settings(id)
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [id]);

  // Background jobs: re-read whenever Shelley's row count changes.
  const runningJobs = listRow?.running_background_jobs ?? 0;
  useEffect(() => {
    if (!runningJobs) {
      setJobs([]);
      return;
    }
    shelleyApi
      .backgroundJobs(id)
      .then((j) => setJobs(Array.isArray(j) ? j : []))
      .catch(() => setJobs([]));
  }, [id, runningJobs]);

  const subagentCount = state.subagents.length;
  useEffect(() => {
    if (!subagentCount || working) return;
    shelleyApi
      .subagentUsage(id)
      .then((u) => setSubagentCost(u.reported_usd || u.estimated_usd || 0))
      .catch(() => setSubagentCost(0));
  }, [id, subagentCount, working]);

  // Unread: what is on screen while the tab is visible counts as seen.
  const maxSeq = state.maxSequenceId;
  useEffect(() => {
    if (!maxSeq) return;
    const mark = () => {
      if (document.visibilityState !== "visible") return;
      patchList(id, { unread: false, followed: true });
      void shelleyApi.markSeen(id, maxSeq).catch(() => undefined);
    };
    const timer = setTimeout(mark, 600);
    document.addEventListener("visibilitychange", mark);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [id, maxSeq, patchList]);

  const run = useCallback(
    async (what: string, action: () => Promise<unknown>, after?: () => void) => {
      try {
        await action();
        after?.();
      } catch (error) {
        toast.error(errorMessage(error, `Could not ${what}.`));
      }
    },
    [],
  );

  const actions: TranscriptActions = useMemo(
    () => ({
      retry: () => void run("retry", () => shelleyApi.action(id, "retry")),
      resume: () => void run("resume", () => shelleyApi.action(id, "resume")),
      continueWith: () => void run("continue", () => shelleyApi.continueWith(id)),
      fork: (messageId) =>
        void run("fork", async () => {
          const forked = await shelleyApi.fork(id, messageId);
          if (forked.conversation_id) navigate(`/code/${forked.conversation_id}`);
        }),
    }),
    [id, navigate, run],
  );

  const model = models.find((m) => m.id === (settings?.model || row?.model));
  const levels = model?.supports_reasoning === false ? [] : THINKING_LEVELS;
  const queue = queuedMessages(conversation ?? listRow);
  const chain = ancestry(rows, id);
  const cost = totalCost(messages) + subagentCost;
  const runningSubagents = state.subagents
    .map((s) => rows.find((r) => r.conversation_id === s.conversation_id) ?? s)
    .filter((s) => s.working ?? s.agent_working);
  const lastNoticeIndex = (() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === "notice" && item.level === "error") return i;
      if (item.kind === "assistant" || item.kind === "tool" || item.kind === "user") return -1;
    }
    return -1;
  })();

  const changeSetting = (change: { model?: string; thinking_level?: string }) =>
    void run("change the settings", async () => {
      const next = await shelleyApi.setSettings(id, change);
      setSettings(next);
      toast.success("Takes effect on the next turn");
    });

  const archived = Boolean(row?.archived);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-border space-y-1 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label="All conversations"
          >
            <Link to="/code">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <nav aria-label="Conversation path" className="flex min-w-0 items-center gap-1 text-sm">
              {chain.length > 1 ? (
                chain.map((c, i) => (
                  <span key={c.conversation_id} className="flex min-w-0 items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground">›</span>}
                    {c.conversation_id === id ? (
                      <span className="truncate font-medium">{conversationTitle(c)}</span>
                    ) : (
                      <Link
                        to={`/code/${c.conversation_id}`}
                        className="text-muted-foreground hover:text-foreground truncate"
                      >
                        {conversationTitle(c)}
                      </Link>
                    )}
                  </span>
                ))
              ) : (
                <span className="truncate font-medium" data-testid="code-title">
                  {row ? conversationTitle(row) : id}
                </span>
              )}
              {archived && (
                <span className="text-muted-foreground shrink-0 text-xs">· archived</span>
              )}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {working ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void run("stop Shelley", () => shelleyApi.action(id, "cancel"))}
                data-testid="code-stop"
                title="Stop (⌘.)"
              >
                <Square />
                Stop
              </Button>
            ) : row?.turn_interrupted ? (
              <Button variant="outline" size="sm" onClick={actions.resume}>
                <Play />
                Resume
              </Button>
            ) : null}
            <Button
              variant={changesOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={onToggleChanges}
              disabled={!row?.cwd}
              title="Changes (⌘⇧D)"
              data-testid="code-changes-toggle"
            >
              <FileDiff />
              <span className="hidden sm:inline">Changes</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDialog("rename")}>
                  <Pencil />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("cwd")}>
                  <FolderOpen />
                  Change directory
                </DropdownMenuItem>
                {publicUrl && row?.slug && (
                  <DropdownMenuItem asChild>
                    <a
                      href={`${publicUrl}/c/${encodeURIComponent(row.slug)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink />
                      Open in Shelley
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    void run(
                      archived ? "unarchive" : "archive",
                      () => shelleyApi.action(id, archived ? "unarchive" : "archive"),
                      () => void state.reload(),
                    )
                  }
                >
                  {archived ? <ArchiveRestore /> : <Archive />}
                  {archived ? "Unarchive" : "Archive"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    void (async () => {
                      const ok = await confirm({
                        title: "Delete this conversation?",
                        description: "Shelley deletes it and its messages. This can't be undone.",
                        destructive: true,
                        confirmLabel: "Delete",
                      });
                      if (!ok) return;
                      await run(
                        "delete",
                        () => shelleyApi.action(id, "delete"),
                        () => navigate("/code"),
                      );
                    })()
                  }
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1">
            <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
              {row?.cwd && (
                <span className={cn("truncate", monoClass)} title={row.cwd}>
                  {shortPath(row.cwd)}
                </span>
              )}
              {row?.git_commit && (
                <span className="truncate" title={row.git_subject}>
                  <span className={monoClass}>{row.git_commit}</span>
                  {row.git_subject ? ` ${row.git_subject}` : ""}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {models.length > 0 && settings && (
              <Select
                value={settings.model || row?.model || ""}
                onValueChange={(m) => changeSetting({ model: m })}
              >
                <SelectTrigger size="sm" className="max-w-44" aria-label="Model">
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent>
                  {models
                    .filter((m) => m.ready)
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.display_name || m.id}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            {settings && levels.length > 0 && (
              <Select
                value={settings.thinking_level || "default"}
                onValueChange={(v) => changeSetting({ thinking_level: v === "default" ? "" : v })}
              >
                <SelectTrigger size="sm" className="w-28" aria-label="Reasoning">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  {levels.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <ContextMeter
              used={state.contextWindow}
              max={model?.max_context_tokens}
              onCompact={() =>
                void run("compact", async () => {
                  await shelleyApi.chat(id, "/compact", { queue: working });
                  toast.success("Compacting the context");
                })
              }
            />
            {cost > 0 && (
              <span
                className="text-muted-foreground text-xs tabular-nums"
                title="Cost of this conversation, subagents included"
              >
                {formatCost(cost)}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {!state.loaded ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="h-full">
              <MessageScrollerViewport className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-5">
                <MessageScrollerContent className="space-y-3" data-testid="code-transcript">
                  {items.map((item, i) => (
                    <MessageScrollerItem
                      key={item.key}
                      messageId={item.key}
                      scrollAnchor={item.kind === "user"}
                    >
                      <TranscriptRow
                        item={item}
                        rows={rows}
                        actions={actions}
                        isLastNotice={i === lastNoticeIndex}
                      />
                    </MessageScrollerItem>
                  ))}
                  {working && (
                    <MessageScrollerItem messageId="streaming">
                      <StreamingTail text={state.partialText} thinking={state.partialThinking} />
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </div>

      {state.error && (
        <p className="text-destructive border-border border-t px-4 py-1.5 text-xs">
          {state.error} — reconnecting…
        </p>
      )}

      <div className="border-border space-y-2 border-t p-3">
        <div className="mx-auto max-w-3xl space-y-2">
          {(working || jobs.length > 0 || runningSubagents.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="code-running">
              <span className="text-muted-foreground">Running:</span>
              {working && (
                <span className="bg-muted flex items-center gap-1 rounded-full px-2 py-0.5">
                  <Spinner className="size-3" />
                  turn
                </span>
              )}
              {jobs.map((job) => (
                <span
                  key={job.id}
                  className="bg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2"
                >
                  <SquareTerminal className="size-3" />
                  <span className={cn("max-w-48 truncate", monoClass)}>
                    {job.command ?? job.id}
                  </span>
                  <button
                    type="button"
                    aria-label="Kill job"
                    title="Kill job"
                    className="hover:bg-background rounded-full p-0.5"
                    onClick={() =>
                      void run(
                        "kill the job",
                        () => shelleyApi.killJob(id, job.id),
                        () => setJobs((prev) => prev.filter((j) => j.id !== job.id)),
                      )
                    }
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {runningSubagents.map((s) => (
                <span
                  key={s.conversation_id}
                  className="bg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2"
                >
                  <Bot className="size-3" />
                  <Link
                    to={`/code/${s.conversation_id}`}
                    className="max-w-40 truncate hover:underline"
                  >
                    {conversationTitle(s)}
                  </Link>
                  <button
                    type="button"
                    aria-label="Stop subagent"
                    title="Stop subagent"
                    className="hover:bg-background rounded-full p-0.5"
                    onClick={() =>
                      void run("stop the subagent", () =>
                        shelleyApi.action(s.conversation_id, "cancel"),
                      )
                    }
                  >
                    <Square className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {queue.length > 0 && (
            <ul className="space-y-1" data-testid="code-queued">
              {queue.map((q) => (
                <li
                  key={q.id}
                  className="bg-muted/60 flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm"
                >
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {q.fromSubagent ? `From ${q.fromSubagent}` : "Queued"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{q.text}</span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Send now"
                    title="Send now (interrupts the turn)"
                    onClick={() =>
                      void run("send it now", () => shelleyApi.queued(id, "send", q.id))
                    }
                  >
                    <Send />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Cancel queued message"
                    onClick={() =>
                      void run("cancel it", () => shelleyApi.queued(id, "cancel", q.id))
                    }
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Composer
            draftKey={id}
            cwd={row?.cwd}
            conversationId={id}
            working={working}
            insert={insert}
            onSend={async (message, { queue: q, skills }) => {
              await shelleyApi.chat(id, message, { queue: q, skills });
            }}
          />
        </div>
      </div>

      <PromptDialog
        open={dialog === "rename"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Rename conversation"
        initial={row?.slug ?? ""}
        label="Rename"
        onSubmit={async (slug) => {
          await shelleyApi.rename(id, slug);
          await state.reload();
        }}
      />
      <PromptDialog
        open={dialog === "cwd"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Change working directory"
        description="Shelley runs later tools in this directory."
        initial={row?.cwd ?? ""}
        label="Change"
        onSubmit={async (cwd) => {
          const check = await shelleyApi.validateCwd(cwd);
          if (!check.valid) throw new Error(check.error ?? "Not a directory Shelley can use.");
          await shelleyApi.setCwd(id, cwd);
          await state.reload();
        }}
      />
    </div>
  );
}
