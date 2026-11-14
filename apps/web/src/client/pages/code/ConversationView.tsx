/**
 * One Code thread (issue #143, ADR 0011): a one-line header (path, title
 * menu, cost, Changes), the live transcript with finished tool runs folded
 * into one line each, what is running (background jobs, subagents), queued
 * messages, and the composer with the model, reasoning, permission and
 * context chips and Stop. Every control comes from the thread's harness's
 * capabilities: what the harness cannot do is not offered.
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
  codeApi,
  shortPath,
  threadPath,
  type HarnessInfo,
  type ModelOption,
  type PermissionMode,
  type ThreadSettings,
  type ThreadSummary,
} from "../../lib/code/api";
import { ancestry } from "../../lib/code/list";
import { groupTools, lastErrorId } from "../../lib/code/transcript";
import { useCodeThread } from "../../lib/code/use-thread";
import { useCodeStore } from "../../store/code";
import { Composer } from "./Composer";
import {
  ContextRing,
  DEFAULT,
  ModelPicker,
  PermissionPicker,
  ReasoningPicker,
  loadModels,
  useArchive,
} from "./controls";
import {
  StreamingTail,
  TranscriptRow,
  formatCost,
  type TranscriptActions,
  type TranscriptContext,
} from "./Transcript";

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
  harness,
  rows,
  externalUrl,
  changesOpen,
  onToggleChanges,
  insert,
  onCwd,
}: {
  id: string;
  harness: HarnessInfo;
  rows: ThreadSummary[];
  /** "Open in <harness>", when it has its own UI (the list row's). */
  externalUrl?: string;
  changesOpen: boolean;
  onToggleChanges(): void;
  insert: { text: string; nonce: number } | null;
  onCwd?(cwd: string | null): void;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const state = useCodeThread(id);
  const { thread, working, items, settings } = state;
  const caps = harness.capabilities;
  const listRow = rows.find((r) => r.id === id);
  const row = (thread ?? listRow) as ThreadSummary | undefined;
  const [models, setModels] = useState<ModelOption[]>([]);
  const [dialog, setDialog] = useState<"rename" | "cwd" | null>(null);
  const patchList = useCodeStore((s) => s.patch);
  const archive = useArchive();

  useEffect(() => {
    void loadModels(harness.id)
      .then(setModels)
      .catch(() => setModels([]));
  }, [harness.id]);

  // Unread: what is on screen while the tab is visible counts as seen.
  const cursor = state.cursor;
  useEffect(() => {
    if (!cursor) return;
    const mark = () => {
      if (document.visibilityState !== "visible") return;
      patchList(id, { unread: false, followed: true });
      void codeApi.markSeen(id, cursor).catch(() => undefined);
    };
    const timer = setTimeout(mark, 600);
    document.addEventListener("visibilitychange", mark);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [id, cursor, patchList]);

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
      recovery: caps.turns.recovery,
      recover: (action) => void run(action, () => codeApi.recover(id, action)),
      ...(caps.threads.fork
        ? {
            fork: (at: string) =>
              void run("fork", async () => {
                const forked = await codeApi.fork(id, at);
                navigate(threadPath(forked.threadId));
              }),
          }
        : {}),
      respond: async (requestId, answer) => {
        await codeApi.respond(id, requestId, answer);
      },
    }),
    [id, navigate, run, caps],
  );
  const ctx: TranscriptContext = useMemo(
    () => ({ instanceId: harness.id, rows }),
    [harness.id, rows],
  );

  const model = models.find((m) => m.id === (settings?.model || row?.model));
  const canReason = model?.supportsReasoning !== false;
  const chain = ancestry(rows, id);
  const display = useMemo(() => groupTools(items), [items]);
  const lastNoticeKey = useMemo(() => lastErrorId(items), [items]);
  const runningSubagents = state.children
    .map((s) => rows.find((r) => r.id === s.id) ?? s)
    .filter((s) => s.working);

  const changeSetting = (change: Partial<ThreadSettings>, note = "Takes effect on the next turn") =>
    void run("change the settings", async () => {
      state.setSettings(await codeApi.settings(id, change));
      toast.success(note);
    });

  const stop = () => void run(`stop ${harness.label}`, () => codeApi.interrupt(id));
  const archived = Boolean(row?.archived);
  const cwd = row?.cwd ?? null;
  useEffect(() => onCwd?.(cwd), [cwd, onCwd]);
  const title = row?.title ?? id;
  const toggleArchive = () =>
    void archive({ id, title }, !archived, { leave: !archived }).then(
      (done) => done && archived && void state.reload(),
    );
  const remove = async () => {
    const ok = await confirm({
      title: "Delete this thread?",
      description: `${harness.label} deletes it and its messages. This can't be undone.`,
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await run(
      "delete",
      () => codeApi.remove(id),
      () => navigate("/code"),
    );
  };
  const permission = (settings?.permissionMode ??
    row?.permissionMode ??
    null) as PermissionMode | null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-border flex h-13 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="shrink-0 md:hidden"
          aria-label="All threads"
        >
          <Link to="/code">
            <ArrowLeft />
          </Link>
        </Button>
        <nav aria-label="Thread path" className="flex min-w-0 items-center gap-0.5 text-sm">
          {chain.slice(0, -1).map((c) => (
            <span key={c.id} className="hidden min-w-0 shrink items-center gap-0.5 sm:flex">
              <Link
                to={threadPath(c.id)}
                className="text-muted-foreground hover:text-foreground max-w-40 truncate rounded-md px-1"
              >
                {c.title}
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
                aria-label={`${title}: thread actions`}
              >
                {chain.length > 1 && <Bot className="text-muted-foreground size-4 shrink-0" />}
                <span className="truncate" data-testid="code-title">
                  {title}
                </span>
                <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <p className="text-muted-foreground px-2 py-1 text-xs">{harness.label}</p>
              {caps.threads.rename && (
                <DropdownMenuItem onSelect={() => setDialog("rename")}>
                  <Pencil />
                  Rename
                </DropdownMenuItem>
              )}
              {caps.threads.changeCwd && (
                <DropdownMenuItem onSelect={() => setDialog("cwd")}>
                  <FolderOpen />
                  Change directory
                </DropdownMenuItem>
              )}
              {(externalUrl ?? thread?.externalUrl) && (
                <DropdownMenuItem asChild>
                  <a href={externalUrl ?? thread?.externalUrl} target="_blank" rel="noreferrer">
                    <ExternalLink />
                    Open in {harness.label}
                  </a>
                </DropdownMenuItem>
              )}
              {(caps.threads.archive || caps.threads.delete) && <DropdownMenuSeparator />}
              {caps.threads.archive && (
                <DropdownMenuItem onSelect={toggleArchive}>
                  {archived ? <ArchiveRestore /> : <Archive />}
                  {archived ? "Restore" : "Archive"}
                  {caps.threads.subagents && (
                    <span className="text-muted-foreground ml-auto text-xs">with subagents</span>
                  )}
                </DropdownMenuItem>
              )}
              {caps.threads.delete && (
                <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        {(row?.cwd || row?.gitCommit) && (
          <span className="text-muted-foreground hidden min-w-0 shrink-[4] items-center gap-2 overflow-hidden text-xs lg:flex">
            {row?.cwd && (
              <span className={cn("truncate", monoClass)} title={row.cwd}>
                {shortPath(row.cwd)}
              </span>
            )}
            {row?.gitCommit && (
              <span className="flex shrink-0 items-center gap-1" title={row.gitSubject ?? ""}>
                <GitCommitHorizontal className="size-3.5 shrink-0" />
                <span className={monoClass}>{row.gitCommit.slice(0, 7)}</span>
              </span>
            )}
          </span>
        )}
        <span className="min-w-2 flex-1" />
        {state.costUsd > 0 && (
          <span
            className="text-muted-foreground hidden px-1 text-xs tabular-nums sm:inline"
            title="Cost of this thread, subagents included"
            data-testid="code-cost"
          >
            {formatCost(state.costUsd)}
          </span>
        )}
        {!working && row?.turnInterrupted && caps.turns.recovery.includes("resume") && (
          <Button variant="outline" size="sm" onClick={() => actions.recover("resume")}>
            <Play />
            Resume
          </Button>
        )}
        {caps.threads.archive && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleArchive}
            aria-label={archived ? "Restore thread" : "Archive thread"}
            title={archived ? "Restore" : "Archive"}
            className="text-muted-foreground"
            data-testid="code-archive"
          >
            {archived ? <ArchiveRestore /> : <Archive />}
          </Button>
        )}
        {caps.workspace.diffs && (
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
        )}
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
                      key={item.id}
                      messageId={item.id}
                      scrollAnchor={item.kind === "user"}
                    >
                      <TranscriptRow
                        item={item}
                        ctx={ctx}
                        actions={actions}
                        isLastNotice={item.id === lastNoticeKey}
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
              {state.error}, reconnecting…
            </p>
          )}
          {archived && (
            <div
              className="bg-muted/60 text-muted-foreground flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
              data-testid="code-archived"
            >
              <Archive className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">This thread is archived.</span>
              <Button size="xs" variant="outline" onClick={toggleArchive}>
                <ArchiveRestore />
                Restore
              </Button>
            </div>
          )}
          {(state.jobs.length > 0 || runningSubagents.length > 0) && (
            <div
              className="flex flex-wrap items-center gap-1.5 px-1 text-xs"
              data-testid="code-running"
            >
              {state.jobs.map((job) => (
                <span
                  key={job.id}
                  className="bg-muted flex items-center gap-1.5 rounded-full py-0.5 pr-0.5 pl-2"
                >
                  <SquareTerminal className="text-muted-foreground size-3" />
                  <span className={cn("max-w-48 truncate", monoClass)}>{job.command}</span>
                  {caps.extras.jobs && (
                    <button
                      type="button"
                      aria-label="Kill job"
                      title="Kill job"
                      className="text-muted-foreground hover:bg-background hover:text-foreground rounded-full p-0.5"
                      onClick={() => void run("kill the job", () => codeApi.killJob(id, job.id))}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))}
              {runningSubagents.map((s) => (
                <span
                  key={s.id}
                  className="bg-muted flex items-center gap-1.5 rounded-full py-0.5 pr-0.5 pl-2"
                >
                  <Spinner className="size-3" />
                  <Link to={threadPath(s.id)} className="max-w-40 truncate hover:underline">
                    {s.title}
                  </Link>
                  <button
                    type="button"
                    aria-label="Stop subagent"
                    title="Stop subagent"
                    className="text-muted-foreground hover:bg-background hover:text-foreground rounded-full p-0.5"
                    onClick={() => void run("stop the subagent", () => codeApi.interrupt(s.id))}
                  >
                    <Square className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {state.queued.length > 0 && (
            <ul className="flex flex-col items-end gap-1" data-testid="code-queued">
              {state.queued.map((q) => (
                <li
                  key={q.id}
                  className="bg-muted/60 flex max-w-[85%] min-w-0 items-center gap-2 rounded-2xl py-1 pr-1 pl-3 text-sm"
                >
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {q.from ? `From ${q.from}` : "Queued"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{q.text}</span>
                  {caps.turns.manageQueue && (
                    <>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Send now"
                        title="Send now (interrupts the turn)"
                        onClick={() =>
                          void run("send it now", () => codeApi.queued(id, q.id, "send"))
                        }
                      >
                        <Send />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Cancel queued message"
                        onClick={() =>
                          void run("cancel it", () => codeApi.queued(id, q.id, "cancel"))
                        }
                      >
                        <X />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Composer
            draftKey={id}
            harness={harness}
            cwd={row?.cwd}
            threadId={id}
            working={working}
            insert={insert}
            onStop={caps.turns.interrupt ? stop : undefined}
            controls={
              <>
                {caps.settings.modelSwitch && models.length > 0 && settings && (
                  <ModelPicker
                    models={models}
                    value={settings.model || row?.model || ""}
                    onChange={(m) => changeSetting({ model: m })}
                  />
                )}
                {caps.settings.modelSwitch && settings && canReason && (
                  <ReasoningPicker
                    levels={caps.settings.effortLevels}
                    value={settings.effort || DEFAULT}
                    onChange={(v) => changeSetting({ effort: v === DEFAULT ? null : v })}
                  />
                )}
                {permission && caps.settings.permissionModes.length > 0 && (
                  <PermissionPicker
                    modes={caps.settings.permissionModes}
                    value={permission}
                    onChange={(mode) =>
                      changeSetting({ permissionMode: mode }, "Permissions changed")
                    }
                  />
                )}
                <ContextRing
                  used={state.context.used}
                  max={state.context.max ?? model?.contextWindow}
                  threadId={id}
                  usage={caps.extras.usageReport}
                  hasSubagents={state.children.length > 0}
                  {...(caps.turns.compact
                    ? {
                        onCompact: () =>
                          void run("compact", async () => {
                            await codeApi.send(id, "/compact", { queue: working });
                            toast.success("Compacting the context");
                          }),
                      }
                    : {})}
                />
              </>
            }
            onSend={async (message, options) => {
              await codeApi.send(id, message, options);
            }}
          />
        </div>
      </div>

      <PromptDialog
        open={dialog === "rename"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Rename thread"
        initial={row?.title ?? ""}
        label="Rename"
        onSubmit={async (next) => {
          await codeApi.rename(id, next);
          await state.reload();
        }}
      />
      <PromptDialog
        open={dialog === "cwd"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Change working directory"
        description={`${harness.label} runs later tools in this directory.`}
        initial={row?.cwd ?? ""}
        label="Change"
        onSubmit={async (next) => {
          await codeApi.setCwd(id, next);
          await state.reload();
        }}
      />
    </div>
  );
}
