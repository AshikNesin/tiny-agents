import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArchiveRestore, ArrowLeft, ExternalLink, GitBranch, Play, Send, X } from "lucide-react";
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
import { foldTurns, lastErrorId } from "../../lib/code/transcript";
import { useCodeThread, type ThreadState } from "../../lib/code/use-thread";
import { useCodeStore } from "../../store/code";
import { useViewerRole } from "../../store/people";
import { useCommentStore, useThreadComments } from "../../lib/code/comments";
import { Composer } from "./Composer";
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

export interface ThreadHandle {
  working: boolean;
  archived: boolean;
  title: string;
  stop(): void;
  toggleArchive(): void;
}

function useMarkSeen(id: string, cursor: number) {
  const patchList = useCodeStore((s) => s.patch);
  const { mutate: markSeen } = useMutation({
    mutationFn: (seen: { id: string; cursor: number }) => codeApi.markSeen(seen.id, seen.cursor),
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
}: {
  row: ThreadSummary | undefined;
  projectName?: string;
  branch?: string | null;
  pr: { number: number; loop: string; url: string } | null;
  costUsd: number;
  onResume?: () => void;
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
    </header>
  );
}

function Queued({
  id,
  state,
  manage,
  run,
}: {
  id: string;
  state: ThreadState;
  manage: boolean;
  run(what: string, action: () => Promise<unknown>): Promise<void>;
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
  onCwd,
  onHandle,
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
  onCwd?(cwd: string | null): void;
  onHandle?(handle: ThreadHandle | null): void;
}) {
  const navigate = useNavigate();
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
  const display = useMemo(() => foldTurns(items), [items]);
  const lastNoticeKey = useMemo(() => lastErrorId(items), [items]);

  const archived = Boolean(row?.archived || listRow?.archived);
  const title = row?.title ?? id;
  const cwd = row?.cwd ?? null;
  useEffect(() => onCwd?.(cwd), [cwd, onCwd]);

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
  useEffect(() => {
    onHandle?.({ working, archived, title, stop, toggleArchive });
    return () => onHandle?.(null);
  }, [onHandle, working, archived, title, stop, toggleArchive]);

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
      {header && (
        <Header
          row={row}
          projectName={projectName}
          branch={branch}
          pr={pr}
          costUsd={state.costUsd}
          onResume={canResume}
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

      <div className="pb-2">
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
              <Queued id={id} state={state} manage={caps.turns.manageQueue} run={run} />
              <PendingComments threadId={id} enabled={owner} onShow={onShowChanges} />
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
