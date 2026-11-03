/**
 * One Shelley conversation on the Code page (issue #143): a one-line header
 * (path, title menu, cost, Changes), the live transcript with finished tool
 * runs folded into one line each, what is running (background jobs,
 * subagents), queued messages, and the composer with the model, reasoning
 * and context chips and Stop.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bot,
  ChevronDown,
  ExternalLink,
  FileDiff,
  FolderOpen,
  GitCommitHorizontal,
  Pencil,
  Play,
  Send,
  Square,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Input, monoClass } from "@groot/ui";
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
import { groupTools, totalCost } from "../../lib/shelley/transcript";
import { useShelleyConversation } from "../../lib/shelley/use-conversation";
import { useShelleyStore } from "../../store/shelley";
import { Composer } from "./Composer";
import {
  ContextRing,
  DEFAULT,
  ModelPicker,
  ReasoningPicker,
  loadModels,
  useArchive,
} from "./controls";
import { StreamingTail, TranscriptRow, formatCost, type TranscriptActions } from "./Transcript";

export { loadModels };

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

export function ConversationView({
  id,
  rows,
  publicUrl,
  changesOpen,
  onToggleChanges,
  insert,
  onCwd,
}: {
  id: string;
  rows: ShelleyConversation[];
  publicUrl: string | null;
  changesOpen: boolean;
  onToggleChanges(): void;
  insert: { text: string; nonce: number } | null;
  onCwd?(cwd: string | null): void;
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
  const archive = useArchive();

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
  const canReason = model?.supports_reasoning !== false;
  const queue = queuedMessages(conversation ?? listRow);
  const chain = ancestry(rows, id);
  const cost = totalCost(messages) + subagentCost;
  const display = useMemo(() => groupTools(items), [items]);
  const runningSubagents = state.subagents
    .map((s) => rows.find((r) => r.conversation_id === s.conversation_id) ?? s)
    .filter((s) => s.working ?? s.agent_working);
  const lastNoticeKey = (() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === "notice" && item.level === "error") return item.key;
      if (item.kind === "assistant" || item.kind === "tool" || item.kind === "user") return null;
    }
    return null;
  })();

  const changeSetting = (change: { model?: string; thinking_level?: string }) =>
    void run("change the settings", async () => {
      const next = await shelleyApi.setSettings(id, change);
      setSettings(next);
      toast.success("Takes effect on the next turn");
    });

  const stop = () => void run("stop Shelley", () => shelleyApi.action(id, "cancel"));
  const archived = Boolean(row?.archived);
  const cwd = row?.cwd ?? null;
  useEffect(() => onCwd?.(cwd), [cwd, onCwd]);
  const title = row ? conversationTitle(row) : id;
  const toggleArchive = () =>
    void archive({ conversation_id: id, slug: row?.slug ?? null }, !archived, {
      leave: !archived,
    }).then((done) => done && archived && void state.reload());
  const remove = async () => {
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
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-border flex h-13 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="shrink-0 md:hidden"
          aria-label="All conversations"
        >
          <Link to="/code">
            <ArrowLeft />
          </Link>
        </Button>
        <nav aria-label="Conversation path" className="flex min-w-0 items-center gap-0.5 text-sm">
          {chain.slice(0, -1).map((c) => (
            <span
              key={c.conversation_id}
              className="hidden min-w-0 shrink items-center gap-0.5 sm:flex"
            >
              <Link
                to={`/code/${c.conversation_id}`}
                className="text-muted-foreground hover:text-foreground max-w-40 truncate rounded-md px-1"
              >
                {conversationTitle(c)}
              </Link>
              <span className="text-muted-foreground/60" aria-hidden>
                /
              </span>
            </span>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="hover:bg-muted aria-expanded:bg-muted flex h-8 min-w-0 items-center gap-1 rounded-lg px-2 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-label={`${title}: conversation actions`}
              >
                {chain.length > 1 && <Bot className="text-muted-foreground size-4 shrink-0" />}
                <span className="truncate" data-testid="code-title">
                  {title}
                </span>
                <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
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
              <DropdownMenuItem onSelect={toggleArchive}>
                {archived ? <ArchiveRestore /> : <Archive />}
                {archived ? "Restore" : "Archive"}
                <span className="text-muted-foreground ml-auto text-xs">with subagents</span>
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        {(row?.cwd || row?.git_commit) && (
          <span className="text-muted-foreground hidden min-w-0 shrink-[4] items-center gap-2 overflow-hidden text-xs lg:flex">
            {row?.cwd && (
              <span className={cn("truncate", monoClass)} title={row.cwd}>
                {shortPath(row.cwd)}
              </span>
            )}
            {row?.git_commit && (
              <span className="flex shrink-0 items-center gap-1" title={row.git_subject}>
                <GitCommitHorizontal className="size-3.5 shrink-0" />
                <span className={monoClass}>{row.git_commit.slice(0, 7)}</span>
              </span>
            )}
          </span>
        )}
        <span className="min-w-2 flex-1" />
        {cost > 0 && (
          <span
            className="text-muted-foreground hidden px-1 text-xs tabular-nums sm:inline"
            title="Cost of this conversation, subagents included"
            data-testid="code-cost"
          >
            {formatCost(cost)}
          </span>
        )}
        {!working && row?.turn_interrupted && (
          <Button variant="outline" size="sm" onClick={actions.resume}>
            <Play />
            Resume
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleArchive}
          aria-label={archived ? "Restore conversation" : "Archive conversation"}
          title={archived ? "Restore (with subagents)" : "Archive (with subagents)"}
          className="text-muted-foreground"
          data-testid="code-archive"
        >
          {archived ? <ArchiveRestore /> : <Archive />}
        </Button>
        <Button
          variant={changesOpen ? "secondary" : "ghost"}
          size="sm"
          onClick={onToggleChanges}
          disabled={!row?.cwd}
          title="Changes (⌘⇧D)"
          aria-pressed={changesOpen}
          className={cn(!changesOpen && "text-muted-foreground")}
          data-testid="code-changes-toggle"
        >
          <FileDiff />
          <span className="hidden sm:inline">Changes</span>
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        {!state.loaded ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="h-full">
              <MessageScrollerViewport className="mx-auto w-full max-w-3xl px-4 pt-6 pb-4 sm:px-6">
                <MessageScrollerContent className="gap-5" data-testid="code-transcript">
                  {display.map((item) => (
                    <MessageScrollerItem
                      key={item.key}
                      messageId={item.key}
                      scrollAnchor={item.kind === "user"}
                    >
                      <TranscriptRow
                        item={item}
                        rows={rows}
                        actions={actions}
                        isLastNotice={item.key === lastNoticeKey}
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

      <div className="pb-3">
        <div className="mx-auto max-w-3xl space-y-2 px-3 sm:px-5">
          {state.error && (
            <p className="text-destructive px-1 text-xs" role="status">
              {state.error} — reconnecting…
            </p>
          )}
          {archived && (
            <div
              className="bg-muted/60 text-muted-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
              data-testid="code-archived"
            >
              <Archive className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">This conversation is archived.</span>
              <Button size="xs" variant="outline" onClick={toggleArchive}>
                <ArchiveRestore />
                Restore
              </Button>
            </div>
          )}
          {(jobs.length > 0 || runningSubagents.length > 0) && (
            <div
              className="flex flex-wrap items-center gap-1.5 px-1 text-xs"
              data-testid="code-running"
            >
              {jobs.map((job) => (
                <span
                  key={job.id}
                  className="bg-muted flex items-center gap-1.5 rounded-full py-0.5 pr-0.5 pl-2"
                >
                  <SquareTerminal className="text-muted-foreground size-3" />
                  <span className={cn("max-w-48 truncate", monoClass)}>
                    {job.command ?? job.id}
                  </span>
                  <button
                    type="button"
                    aria-label="Kill job"
                    title="Kill job"
                    className="text-muted-foreground hover:bg-background hover:text-foreground rounded-full p-0.5"
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
                  className="bg-muted flex items-center gap-1.5 rounded-full py-0.5 pr-0.5 pl-2"
                >
                  <Spinner className="size-3" />
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
                    className="text-muted-foreground hover:bg-background hover:text-foreground rounded-full p-0.5"
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
            <ul className="flex flex-col items-end gap-1" data-testid="code-queued">
              {queue.map((q) => (
                <li
                  key={q.id}
                  className="bg-muted/60 flex max-w-[85%] min-w-0 items-center gap-2 rounded-2xl py-1 pr-1 pl-3 text-sm"
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
            onStop={stop}
            controls={
              <>
                {models.length > 0 && settings && (
                  <ModelPicker
                    models={models}
                    value={settings.model || row?.model || ""}
                    onChange={(m) => changeSetting({ model: m })}
                  />
                )}
                {settings && canReason && (
                  <ReasoningPicker
                    value={settings.thinking_level || DEFAULT}
                    onChange={(v) => changeSetting({ thinking_level: v === DEFAULT ? "" : v })}
                  />
                )}
                <ContextRing
                  used={state.contextWindow}
                  max={model?.max_context_tokens}
                  onCompact={() =>
                    void run("compact", async () => {
                      await shelleyApi.chat(id, "/compact", { queue: working });
                      toast.success("Compacting the context");
                    })
                  }
                />
              </>
            }
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
