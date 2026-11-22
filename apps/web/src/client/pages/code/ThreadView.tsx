import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArchiveRestore,
  ArrowLeft,
  ExternalLink,
  GitBranch,
  Pencil,
  Play,
  Send,
  Square,
  SquareArrowOutUpRight,
  SquareTerminal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, monoClass } from "@groot/ui";
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
  threadPath,
  type HarnessInfo,
  type ModelOption,
  type PermissionMode,
  type ThreadSettings,
  type ThreadSummary,
} from "../../lib/code/api";
import { RESOURCE_MUTATION } from "../../queries/resource";
import { foldTurns, lastErrorId, turnStarts } from "../../lib/code/transcript";
import { useCodeThread, type ThreadState } from "../../lib/code/use-thread";
import { useCodeStore } from "../../store/code";
import { useViewerRole } from "../../store/people";
import { useCommentStore, useThreadComments } from "../../lib/code/comments";
import { isDialogOpen, isEditable, useHotkey } from "@groot/ui/hotkeys";
import { Composer } from "./Composer";
import { CodeKeys, type CodeCommand } from "./keys";
import { OpenInEditor } from "./OpenInEditor";
import { PendingComments } from "./PendingComments";
import {
  ContextRing,
  DEFAULT,
  ModelPicker,
  PermissionPicker,
  PullChip,
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

function useMarkSeen(id: string, cursor: number) {
  const patchList = useCodeStore((s) => s.patch);
  const client = useQueryClient();
  const { mutate: markSeen } = useMutation({
    mutationFn: (seen: { id: string; cursor: number }) => codeApi.markSeen(seen.id, seen.cursor),
    onSuccess: (_done, seen) => client.invalidateQueries({ queryKey: ["code", "thread", seen.id] }),
    ...RESOURCE_MUTATION,
  });
  useEffect(() => {
    if (!cursor) return;
    const mark = () => {
      if (document.visibilityState !== "visible") return;
      patchList(id, { unread: false, followed: true });
      markSeen({ id, cursor });
    };
    const timer = setTimeout(mark, 600);
    document.addEventListener("visibilitychange", mark);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [id, cursor, patchList, markSeen]);
}

function Header({
  row,
  projectName,
  branch,
  pr,
  costUsd,
  onResume,
  onOpenEditor,
}: {
  row: ThreadSummary | undefined;
  projectName?: string;
  branch?: string | null;
  pr: { number: number; loop: string; url: string } | null;
  costUsd: number;
  onResume?: () => void;
  onOpenEditor?: () => void;
}) {
  const place = projectName ?? row?.cwd?.split("/").findLast(Boolean);
  return (
    <header className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <Button asChild variant="ghost" size="icon-sm" className="lg:hidden" aria-label="All threads">
        <Link to="/code">
          <ArrowLeft />
        </Link>
      </Button>
      <h1 className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm">
        {place && (
          <span className="text-muted-foreground hidden shrink-0 sm:inline" title={row?.cwd ?? ""}>
            {place} /
          </span>
        )}
        <span className="truncate font-medium" data-testid="code-title">
          {row?.title || "Untitled"}
        </span>
      </h1>
      {onResume && (
        <Button variant="outline" size="sm" onClick={onResume}>
          <Play />
          Resume
        </Button>
      )}
      {costUsd > 0 && (
        <span
          className="text-muted-foreground hidden text-xs tabular-nums md:inline"
          title="Cost of this thread"
          data-testid="code-cost"
        >
          {formatCost(costUsd)}
        </span>
      )}
      {branch && (
        <span
          className={cn(
            "text-muted-foreground bg-muted hidden h-5 max-w-48 shrink items-center gap-1 rounded-md px-1.5 text-[11px] md:inline-flex",
            monoClass,
          )}
          title={branch}
          data-testid="code-branch"
        >
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      )}
      {pr && (
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={`Open pull request #${pr.number} on GitHub`}
        >
          <PullChip pr={pr} />
          <ExternalLink className="text-muted-foreground size-3" />
        </a>
      )}
      {onOpenEditor && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hidden md:inline-flex"
          aria-label="Open in editor"
          title="Open in editor (o)"
          onClick={onOpenEditor}
        >
          <SquareArrowOutUpRight />
        </Button>
      )}
    </header>
  );
}

function Running({
  id,
  state,
  rows,
  canKill,
  run,
}: {
  id: string;
  state: ThreadState;
  rows: ThreadSummary[];
  canKill: boolean;
  run(what: string, action: () => Promise<unknown>): Promise<void>;
}) {
  const subagents = state.children
    .map((child) => rows.find((row) => row.id === child.id) ?? child)
    .filter((child) => child.working);
  if (state.jobs.length === 0 && subagents.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 text-xs" data-testid="code-running">
      {state.jobs.map((job) => (
        <span
          key={job.id}
          className="bg-muted flex items-center gap-1.5 rounded-full py-0.5 pr-0.5 pl-2"
        >
          <SquareTerminal className="text-muted-foreground size-3" />
          <span className={cn("max-w-48 truncate", monoClass)}>{job.command}</span>
          {canKill && (
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
      {subagents.map((child) => (
        <span
          key={child.id}
          className="bg-muted flex items-center gap-1.5 rounded-full py-0.5 pr-0.5 pl-2"
        >
          <Spinner className="size-3" />
          <Link to={threadPath(child.id)} className="max-w-40 truncate hover:underline">
            {child.title}
          </Link>
          <button
            type="button"
            aria-label="Stop subagent"
            title="Stop subagent"
            className="text-muted-foreground hover:bg-background hover:text-foreground rounded-full p-0.5"
            onClick={() => void run("stop the subagent", () => codeApi.interrupt(child.id))}
          >
            <Square className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function Queued({
  id,
  state,
  manage,
  run,
  onEdit,
}: {
  id: string;
  state: ThreadState;
  manage: boolean;
  run(what: string, action: () => Promise<unknown>): Promise<void>;
  onEdit(text: string): void;
}) {
  if (state.queued.length === 0) return null;
  return (
    <ul className="flex flex-col items-end gap-1" data-testid="code-queued">
      {state.queued.map((q) => (
        <li
          key={q.id}
          className="border-border flex max-w-[85%] min-w-0 items-center gap-2 rounded-2xl border border-dashed py-1 pr-1 pl-3 text-sm"
        >
          <span className="text-muted-foreground shrink-0 text-xs">
            {q.from ? `From ${q.from}` : "Queued"}
          </span>
          <span className="min-w-0 flex-1 truncate">{q.text}</span>
          {manage && (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Edit queued message"
                title="Edit (takes it back into the composer)"
                onClick={() =>
                  void run("take it back", async () => {
                    await codeApi.queued(id, q.id, "cancel");
                    onEdit(q.text);
                  })
                }
              >
                <Pencil />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Send now"
                title="Send now (interrupts the turn)"
                onClick={() => void run("send it now", () => codeApi.queued(id, q.id, "send"))}
              >
                <Send />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Cancel queued message"
                onClick={() => void run("cancel it", () => codeApi.queued(id, q.id, "cancel"))}
              >
                <X />
              </Button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ThreadView({
  id,
  harness,
  rows,
  projectName,
  branch,
  pr = null,
  header = true,
  insert,
  onShowChanges,
  commands = false,
  onReplaced,
  below,
}: {
  id: string;
  harness: HarnessInfo;
  rows: ThreadSummary[];
  projectName?: string;
  branch?: string | null;
  pr?: { number: number; loop: string; url: string } | null;
  header?: boolean;
  insert: { text: string; nonce: number } | null;
  onShowChanges?: () => void;
  commands?: boolean;
  onReplaced?: () => void;
  below?: ReactNode;
}) {
  const state = useCodeThread(id);
  const { thread, working, items, settings } = state;
  const caps = harness.capabilities;
  const listRow = rows.find((r) => r.id === id);
  const row = thread ?? listRow;
  const [models, setModels] = useState<ModelOption[]>([]);
  const archive = useArchive();
  const owner = useViewerRole() === "owner";
  const comments = useThreadComments(id, owner);
  const commentsSent = useCommentStore((s) => s.sent);
  useMarkSeen(id, state.cursor);

  useEffect(() => {
    void loadModels(harness.id)
      .then(setModels)
      .catch((error: unknown) => {
        setModels([]);
        toast.error(errorMessage(error, `Could not load ${harness.label}'s models.`));
      });
  }, [harness.id, harness.label]);

  const run = useCallback(async (what: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      toast.error(errorMessage(error, `Could not ${what}.`));
    }
  }, []);

  const starts = useMemo(() => turnStarts(items), [items]);
  const [editing, setEditing] = useState<string | null>(null);
  const [local, setLocal] = useState<{ text: string; nonce: number } | null>(null);
  const canRewind = caps.threads.rewind && owner && !working;

  const rewind = useCallback(
    async (startId: string, text: string) => {
      const turn = starts.findIndex((start) => start.id === startId);
      if (turn < 0) return;
      const result = await codeApi.rewind(id, {
        at: starts[turn]!.at,
        turn,
        turns: starts.length,
        text,
      });
      setEditing(null);
      onReplaced?.();
      toast.success(
        result.filesRestored
          ? "Went back to before that turn, files included"
          : "Went back to before that turn; the files were left as they are",
        {
          action: {
            label: "Undo",
            onClick: () =>
              void codeApi
                .undoRewind(id, result.replaced)
                .then(() => onReplaced?.())
                .catch((error: unknown) => toast.error(errorMessage(error, "Could not undo."))),
          },
        },
      );
    },
    [id, starts, onReplaced],
  );
  const edit = useCallback(
    (startId: string) => {
      const start = starts.find((candidate) => candidate.id === startId);
      if (!start) return;
      setEditing(startId);
      setLocal({ text: start.text, nonce: Date.now() });
    },
    [starts],
  );
  const retry = useCallback(
    (startId: string) => {
      const start = starts.find((candidate) => candidate.id === startId);
      if (start) void run("run it again", () => rewind(startId, start.text));
    },
    [starts, run, rewind],
  );

  const actions: TranscriptActions = useMemo(
    () => ({
      recovery: caps.turns.recovery,
      recover: (action) => void run(action, () => codeApi.recover(id, action)),
      respond: async (requestId, answer) => {
        await codeApi.respond(id, requestId, answer);
      },
      ...(canRewind
        ? { rewind: { turns: new Set(starts.map((start) => start.id)), edit, retry } }
        : {}),
    }),
    [id, run, caps, canRewind, starts, edit, retry],
  );
  const ctx: TranscriptContext = useMemo(
    () => ({ instanceId: harness.id, rows }),
    [harness.id, rows],
  );
  const display = useMemo(() => foldTurns(items), [items]);
  const lastNoticeKey = useMemo(() => lastErrorId(items), [items]);

  const archived = Boolean(row?.archived || listRow?.archived);
  const title = row?.title ?? id;

  const stop = useCallback(
    () => void run(`stop ${harness.label}`, () => codeApi.interrupt(id)),
    [run, harness.label, id],
  );
  const reload = state.reload;
  const toggleArchive = useCallback(
    () =>
      void archive({ id, title }, !archived, { leave: !archived }).then(
        (done) => done && archived && void reload(),
      ),
    [archive, id, title, archived, reload],
  );
  const canCompact = caps.turns.compact;
  const lastStart = starts.at(-1)?.id;
  const rewinds = useRef({ edit, retry, lastStart });
  useEffect(() => {
    rewinds.current = { edit, retry, lastStart };
  });
  const canRewindLast = canRewind && Boolean(lastStart);
  const compact = useCallback(
    () =>
      void run("compact", async () => {
        await codeApi.send(id, "/compact", { queue: working });
        toast.success("Compacting the context");
      }),
    [run, id, working],
  );
  const [editorOpen, setEditorOpen] = useState(0);
  const folder = listRow?.cwd ?? row?.cwd ?? null;
  const openEditor = useCallback(() => setEditorOpen(Date.now()), []);
  const threadCommands = useMemo<CodeCommand[]>(
    () => [
      {
        id: "open-editor",
        group: "Thread",
        keys: "o",
        label: "Open in editor (Cursor or Zed)",
        enabled: Boolean(folder),
        run: openEditor,
      },
      {
        id: "stop",
        group: "Thread",
        keys: "Escape",
        label: "Stop the agent",
        enabled: working,
        run: stop,
      },
      {
        id: "archive",
        group: "Thread",
        label: archived ? "Restore this thread" : "Archive this thread",
        run: toggleArchive,
      },
      {
        id: "edit",
        group: "Thread",
        keys: "e",
        label: "Edit the last turn and run it again",
        enabled: canRewindLast,
        run: () => rewinds.current.edit(rewinds.current.lastStart!),
      },
      {
        id: "retry",
        group: "Thread",
        keys: "t",
        label: "Run the last turn again",
        enabled: canRewindLast,
        run: () => rewinds.current.retry(rewinds.current.lastStart!),
      },
      {
        id: "compact",
        group: "Thread",
        label: "Compact the context",
        enabled: canCompact,
        run: compact,
      },
    ],
    [
      folder,
      openEditor,
      working,
      stop,
      archived,
      toggleArchive,
      canRewindLast,
      canCompact,
      compact,
    ],
  );
  useHotkey(
    "escape",
    () => {
      if (isDialogOpen()) return;
      const active = document.activeElement;
      if (isEditable(active)) return (active as HTMLElement).blur();
      if (working) stop();
    },
    { inFields: true, enabled: commands },
  );

  const model = models.find((m) => m.id === (settings?.model || row?.model));
  const canReason = model?.supportsReasoning !== false;
  const permission = (settings?.permissionMode ??
    row?.permissionMode ??
    null) as PermissionMode | null;
  const changeSetting = (change: Partial<ThreadSettings>, note = "Takes effect on the next turn") =>
    void run("change the settings", async () => {
      state.setSettings(await codeApi.settings(id, change));
      toast.success(note);
    });
  const canResume =
    !working && row?.turnInterrupted && caps.turns.recovery.includes("resume")
      ? () => actions.recover("resume")
      : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col" id="code-thread" data-working={working}>
      {commands && <CodeKeys source="thread" commands={threadCommands} />}
      {header && (
        <Header
          row={row}
          projectName={projectName}
          branch={branch}
          pr={pr}
          costUsd={state.costUsd}
          onResume={canResume}
          onOpenEditor={folder ? openEditor : undefined}
        />
      )}
      {folder && editorOpen > 0 && (
        <OpenInEditor
          key={editorOpen}
          open
          onOpenChange={(open) => !open && setEditorOpen(0)}
          harness={harness}
          path={folder}
        />
      )}

      <div className="relative min-h-0 flex-1">
        {!state.loaded ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="h-full">
              <MessageScrollerViewport className="mx-auto w-full max-w-3xl px-4 pt-5 pb-4">
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

      {below}
      <div className="pb-2 pt-2">
        <div className="mx-auto max-w-3xl space-y-2 px-3">
          {state.error && (
            <p className="text-destructive px-1 text-xs" role="status">
              {state.error}, reconnecting…
            </p>
          )}
          {archived ? (
            <Button
              variant="outline"
              className="text-muted-foreground h-11 w-full rounded-2xl"
              onClick={toggleArchive}
              data-testid="code-archived"
            >
              <ArchiveRestore />
              Unarchive to continue
            </Button>
          ) : (
            <>
              <Running id={id} state={state} rows={rows} canKill={caps.extras.jobs} run={run} />
              <Queued
                id={id}
                state={state}
                manage={caps.turns.manageQueue}
                run={run}
                onEdit={(text) => setLocal({ text, nonce: Date.now() })}
              />
              {editing && (
                <p
                  className="text-muted-foreground flex items-center gap-2 px-2 text-xs"
                  data-testid="code-editing"
                >
                  <span className="flex-1">
                    Editing an earlier turn. Sending puts the files back as they were before it.
                  </span>
                  <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </p>
              )}
              <PendingComments threadId={id} enabled={owner} onShow={onShowChanges} />
              <Composer
                draftKey={id}
                harness={harness}
                cwd={row?.cwd}
                threadId={id}
                working={working}
                insert={local && (!insert || local.nonce > insert.nonce) ? local : insert}
                submitLabel={editing ? "Run again from here" : undefined}
                onStop={caps.turns.interrupt ? stop : undefined}
                controls={
                  <>
                    {caps.settings.modelSwitch && models.length > 0 && settings && (
                      <ModelPicker
                        bare
                        models={models}
                        value={settings.model || row?.model || ""}
                        onChange={(m) => changeSetting({ model: m })}
                      />
                    )}
                    {caps.settings.modelSwitch && settings && canReason && (
                      <ReasoningPicker
                        bare
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
                    />
                  </>
                }
                onSend={async (message, options) => {
                  if (editing) return rewind(editing, message);
                  const withReview = comments.length > 0;
                  await codeApi.send(id, message, { ...options, withReview });
                  if (withReview) commentsSent(id);
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
