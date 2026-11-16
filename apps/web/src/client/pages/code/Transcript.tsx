/**
 * The Code page transcript (issue #143, ADR 0011): one renderer per row
 * kind and tool kind of the harness contract, so a developer reads a turn
 * the same way whichever harness ran it — the command and its live output,
 * the diff an edit made, the subagent it started, the plan it keeps, and
 * the approvals it waits on.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Streamdown } from "streamdown";
import {
  ArrowUpRight,
  Bot,
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  GitFork,
  Info,
  ListChecks,
  MessageCircle,
  MessageSquare,
  RotateCcw,
  ShieldQuestion,
  SquareTerminal,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { markdownComponents } from "../../lib/markdown";
import { TypingIndicator, USER_PILL } from "../../components/ui/transcript-parts";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "../../components/ui/trace";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "../../components/ui/code-block";
import { Spinner } from "../../components/ui/spinner";
import {
  codeApi,
  threadPath,
  type AssetRef,
  type RecoveryAction,
  type RequestAnswer,
  type ThreadSummary,
  type ToolItem,
  type TranscriptItem,
} from "../../lib/code/api";
import { describeTools, type DisplayItem, type ToolGroup } from "../../lib/code/transcript";
import { parseReviewMessage, type SentComment } from "../../lib/code/comments";
import { PatchView, diffStats } from "./UnifiedDiff";

export interface TranscriptActions {
  /** The harness's ways back from an error (capability `turns.recovery`). */
  recovery: RecoveryAction[];
  recover(action: RecoveryAction): void;
  /** Absent when the harness cannot fork. */
  fork?: (at: string) => void;
  respond(requestId: string, answer: RequestAnswer): Promise<void>;
}

/** What rows need to know about where they are. */
export interface TranscriptContext {
  instanceId: string;
  /** Every thread in the list (subagent links show their state). */
  rows: ThreadSummary[];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatCost(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}

const failedTool = (call: ToolItem) =>
  call.status === "error" ||
  call.status === "denied" ||
  (call.exitCode !== undefined && call.exitCode !== 0);

function copy(text: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Copied"))
    .catch(() => toast.error("Could not copy"));
}

function Output({
  title,
  value,
  destructive,
}: {
  title: string;
  value: string;
  destructive?: boolean;
}) {
  const lines = value.replace(/\n$/, "").split("\n");
  return (
    <CodeBlock size="sm" variant={destructive ? "destructive" : "default"}>
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          onClick={() => copy(value)}
          aria-label={`Copy ${title.toLowerCase()}`}
        >
          <Copy />
        </Button>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-80 overflow-y-auto overscroll-contain">
        {lines.map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function Images({ assets, instanceId }: { assets: AssetRef[]; instanceId: string }) {
  if (assets.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {assets.map((asset) => {
        const src = codeApi.assetUrl(instanceId, asset.ref);
        return (
          <a key={asset.ref} href={src} target="_blank" rel="noreferrer" className="block">
            <img
              src={src}
              alt={asset.name || "Tool output"}
              loading="lazy"
              className="border-border max-h-64 max-w-full rounded-lg border object-contain"
            />
          </a>
        );
      })}
    </div>
  );
}

/** Uploaded files referenced in a message: images inline, others as links. */
function Attachments({ assets, instanceId }: { assets: AssetRef[]; instanceId: string }) {
  if (assets.length === 0) return null;
  const images = assets.filter((a) => a.image);
  const files = assets.filter((a) => !a.image);
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-1">
      <Images assets={images} instanceId={instanceId} />
      {files.map((a) => (
        <a
          key={a.ref}
          href={codeApi.assetUrl(instanceId, a.ref)}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "text-muted-foreground hover:text-foreground truncate text-xs underline",
            monoClass,
          )}
        >
          {a.name}
        </a>
      ))}
    </div>
  );
}

function SubagentRow({ call, ctx }: { call: ToolItem; ctx: TranscriptContext }) {
  const child = call.child;
  const row = child ? ctx.rows.find((r) => r.id === child.threadId) : undefined;
  const title = child?.title ?? call.summary;
  const input = call.input && typeof call.input === "object" ? call.input : undefined;
  const prompt =
    input && "prompt" in input ? String((input as { prompt?: unknown }).prompt ?? "") : "";
  return (
    <div className="border-border flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2">
      <Bot className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Subagent</span>
          <span className={cn("truncate", monoClass)}>{title}</span>
          {row?.working || call.status === "running" ? (
            <Spinner className="size-3.5" aria-label="Working" />
          ) : (
            <CircleCheck className="text-muted-foreground size-3.5" aria-label="Idle" />
          )}
        </div>
        {prompt && <p className="text-muted-foreground truncate text-xs">{prompt}</p>}
      </div>
      {child && (
        <Button asChild size="sm" variant="outline">
          <Link to={threadPath(child.threadId)}>
            Open
            <ArrowUpRight />
          </Link>
        </Button>
      )}
    </div>
  );
}

/** A plan the agent keeps (Claude Code's TodoWrite). */
function TodoRow({ call }: { call: ToolItem }) {
  const input = call.input && typeof call.input === "object" ? call.input : undefined;
  const todos = Array.isArray((input as { todos?: unknown } | undefined)?.todos)
    ? ((input as { todos: Array<{ content?: unknown; status?: unknown }> }).todos ?? [])
    : [];
  if (todos.length === 0) return null;
  return (
    <ul
      className="border-border space-y-1 rounded-xl border px-3 py-2 text-sm"
      data-testid="code-todos"
    >
      {todos.map((todo, i) => {
        const done = todo.status === "completed";
        const active = todo.status === "in_progress";
        return (
          <li key={`${i}:${String(todo.content ?? "")}`} className="flex items-start gap-2">
            {done ? (
              <CircleCheck className="text-success mt-0.5 size-4 shrink-0" aria-label="Done" />
            ) : active ? (
              <Spinner className="mt-0.5 size-4 shrink-0" aria-label="In progress" />
            ) : (
              <CircleDashed className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            )}
            <span className={cn(done && "text-muted-foreground line-through")}>
              {String(todo.content ?? "")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ToolRow({ call, ctx }: { call: ToolItem; ctx: TranscriptContext }) {
  if (call.tool === "subagent") return <SubagentRow call={call} ctx={ctx} />;
  if (call.tool === "todo") return <TodoRow call={call} />;
  const input =
    call.input && typeof call.input === "object"
      ? (call.input as Record<string, unknown>)
      : undefined;
  if (call.tool === "message_user" && typeof input?.text === "string") {
    return (
      <div className="bg-muted/60 flex gap-2 rounded-xl px-3 py-2 text-sm">
        <MessageCircle className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <p className="whitespace-pre-wrap">{input.text}</p>
      </div>
    );
  }
  if (call.tool === "message_parent" && typeof input?.text === "string") {
    return (
      <div className="bg-muted/60 flex gap-2 rounded-xl px-3 py-2 text-sm">
        <ArrowUpRight className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">Report to the parent agent</p>
          <p className="whitespace-pre-wrap">{input.text}</p>
        </div>
      </div>
    );
  }

  const stats = call.diff ? diffStats(call.diff.diff) : undefined;
  const argsJson =
    call.tool === "bash" || (call.tool === "edit" && call.diff) || input === undefined
      ? ""
      : JSON.stringify(call.input, null, 2);
  const command = call.tool === "bash" && typeof input?.command === "string" ? input.command : "";
  const failed = failedTool(call);
  const hasDetail = Boolean(command || argsJson || call.output || call.diff || call.images.length);

  const line = (
    <TraceLine status={call.status === "running" ? "running" : failed ? "error" : undefined}>
      <TraceIcon>
        {call.status === "running" ? (
          <Spinner className="size-3.5" />
        ) : failed ? (
          <CircleX />
        ) : call.tool === "bash" ? (
          <SquareTerminal />
        ) : (
          <CircleCheck />
        )}
      </TraceIcon>
      <TraceTitle>
        {call.name}
        {call.summary && <span className={cn("ml-1.5", monoClass)}>{call.summary}</span>}
      </TraceTitle>
      {stats && (
        <TraceDescription>
          <span className="text-success">+{stats.additions}</span>{" "}
          <span className="text-destructive">−{stats.deletions}</span>
        </TraceDescription>
      )}
      {call.background && <TraceDescription>background</TraceDescription>}
      {call.status === "denied" && <TraceDescription>denied</TraceDescription>}
      {call.exitCode !== undefined && call.exitCode !== 0 && (
        <TraceDescription>exit {call.exitCode}</TraceDescription>
      )}
      {call.durationMs !== undefined && (
        <TraceDescription>{formatDuration(call.durationMs)}</TraceDescription>
      )}
    </TraceLine>
  );

  return (
    <div className="space-y-2">
      <Trace className="gap-1">
        {hasDetail ? (
          // Running commands open by default so their output streams in view.
          <TraceCollapsible defaultOpen={call.status === "running" && call.tool === "bash"}>
            <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
            <TraceCollapsibleContent className="space-y-2">
              {command && <Output title="Command" value={command} />}
              {argsJson && argsJson !== "{}" && <Output title="Input" value={argsJson} />}
              {call.diff && (
                <CodeBlock size="sm">
                  <CodeBlockHeader>
                    <CodeBlockTitle>{call.diff.path}</CodeBlockTitle>
                  </CodeBlockHeader>
                  <PatchView patch={call.diff.diff} className="max-h-96 overflow-y-auto" />
                </CodeBlock>
              )}
              {call.output && !call.diff && (
                <Output
                  title={call.live ? "Output (live)" : "Output"}
                  value={call.output}
                  destructive={failed}
                />
              )}
            </TraceCollapsibleContent>
          </TraceCollapsible>
        ) : (
          line
        )}
      </Trace>
      {/* Screenshots stay visible: they are the point of a browser step. */}
      <Images assets={call.images} instanceId={ctx.instanceId} />
    </div>
  );
}

/** Finished tool calls folded into one line ("Ran 3 commands, edited 2 files"). */
function ToolGroupRow({ group, ctx }: { group: ToolGroup; ctx: TranscriptContext }) {
  const failed = group.tools.filter(failedTool).length;
  const duration = group.tools.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
  return (
    <Trace data-testid="code-tool-group">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <ListChecks />
            </TraceIcon>
            <TraceTitle>{describeTools(group.tools)}</TraceTitle>
            {failed > 0 && (
              <TraceDescription className="text-destructive">· {failed} failed</TraceDescription>
            )}
            {duration > 0 && <TraceDescription>{formatDuration(duration)}</TraceDescription>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="space-y-2">
          {group.items.map((item) =>
            item.kind === "tool" ? (
              <ToolRow key={item.id} call={item} ctx={ctx} />
            ) : (
              <p key={item.id} className="text-muted-foreground text-sm whitespace-pre-wrap italic">
                {item.text}
              </p>
            ),
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function Notice({
  item,
  actions,
  isLast,
}: {
  item: Extract<TranscriptItem, { kind: "notice" }>;
  actions: TranscriptActions;
  isLast: boolean;
}) {
  const Icon =
    item.level === "error" ? TriangleAlert : item.level === "warning" ? TriangleAlert : Info;
  const can = (action: RecoveryAction) => isLast && actions.recovery.includes(action);
  return (
    <div
      className={cn(
        "flex items-start gap-2 text-sm",
        item.level === "error" && "text-destructive",
        item.level === "warning" && "text-warning",
        item.level === "info" && "text-muted-foreground",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1 whitespace-pre-wrap">
        {item.text}
        {item.code === "usage_limit" && item.resetsAt && (
          <span className="text-muted-foreground block text-xs">
            Resets {new Date(item.resetsAt).toLocaleString()}
          </span>
        )}
      </span>
      {item.retryable && can("retry") && (
        <Button size="xs" variant="outline" onClick={() => actions.recover("retry")}>
          <RotateCcw />
          Retry
        </Button>
      )}
      {item.refusal && can("continue") && (
        <Button size="xs" variant="outline" onClick={() => actions.recover("continue")}>
          Try another model
        </Button>
      )}
    </div>
  );
}

/** An approval or a question the harness waits on (capability `approvals`). */
function RequestRow({
  item,
  actions,
}: {
  item: Extract<TranscriptItem, { kind: "request" }>;
  actions: TranscriptActions;
}) {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const open = item.status === "open";
  const answer = (value: RequestAnswer) => {
    setBusy(true);
    actions
      .respond(item.id, value)
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "Could not answer."),
      )
      .finally(() => setBusy(false));
  };
  const { request } = item;
  const outcome =
    item.status === "allowed"
      ? "Allowed"
      : item.status === "denied"
        ? "Denied"
        : item.status === "answered"
          ? "Answered"
          : item.status === "expired"
            ? "No longer waiting"
            : undefined;
  return (
    <div
      className={cn(
        "border-border flex flex-col gap-2 rounded-xl border px-3 py-2 text-sm",
        open && "border-primary/50 bg-primary/5",
      )}
      data-testid="code-request"
    >
      <div className="flex items-start gap-2">
        <ShieldQuestion className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          {request.kind === "tool" ? (
            <>
              <p className="font-medium">
                Allow <span className={monoClass}>{request.name}</span>?
              </p>
              {request.summary && (
                <p className={cn("text-muted-foreground truncate text-xs", monoClass)}>
                  {request.summary}
                </p>
              )}
              {request.reason && <p className="text-muted-foreground text-xs">{request.reason}</p>}
            </>
          ) : (
            request.questions.map((q) => (
              <div key={q.question} className="space-y-1.5">
                <p className="font-medium">{q.question}</p>
                <div className="flex flex-wrap gap-1.5">
                  {q.options.map((option) => (
                    <Button
                      key={option.label}
                      size="xs"
                      variant={picked[q.question] === option.label ? "default" : "outline"}
                      disabled={!open || busy}
                      title={option.description}
                      onClick={() => setPicked((p) => ({ ...p, [q.question]: option.label }))}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        {outcome && <span className="text-muted-foreground shrink-0 text-xs">{outcome}</span>}
      </div>
      {open && (
        <div className="flex justify-end gap-1.5">
          {request.kind === "tool" ? (
            <>
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => answer({ decision: "deny" })}
              >
                <X />
                Deny
              </Button>
              <Button size="xs" disabled={busy} onClick={() => answer({ decision: "allow" })}>
                <Check />
                Allow
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              disabled={busy || request.questions.some((q) => picked[q.question] === undefined)}
              onClick={() => answer({ answers: picked })}
            >
              <Check />
              Answer
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** The owner's message; line comments sent with it read as comment cards above it. */
function UserText({ text }: { text: string }) {
  if (!text) return null;
  const review = parseReviewMessage(text);
  if (!review) {
    return <div className={cn(USER_PILL, "max-w-[85%] whitespace-pre-wrap")}>{text}</div>;
  }
  return (
    <>
      <div className="flex w-full max-w-[85%] flex-col gap-1.5">
        {review.comments.map((comment) => (
          <SentCommentCard
            key={`${comment.path}:${comment.lines}:${comment.body}`}
            comment={comment}
          />
        ))}
      </div>
      {review.message && (
        <div className={cn(USER_PILL, "max-w-[85%] whitespace-pre-wrap")}>{review.message}</div>
      )}
    </>
  );
}

function SentCommentCard({ comment }: { comment: SentComment }) {
  return (
    <article className="ring-foreground/10 bg-card overflow-hidden rounded-xl text-sm ring-1">
      <header className="text-muted-foreground flex items-center gap-1.5 px-3 pt-2 text-xs">
        <MessageSquare className="size-3.5 shrink-0" aria-hidden />
        <span className={cn("min-w-0 truncate", monoClass)}>
          {comment.path}:{comment.lines}
          {comment.old && " (removed)"}
        </span>
      </header>
      {comment.quote && (
        <pre
          className={cn(
            "text-muted-foreground border-border mx-3 mt-1.5 line-clamp-4 border-l-2 pl-2 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]",
            monoClass,
          )}
        >
          {comment.quote}
        </pre>
      )}
      <p className="px-3 pt-1.5 pb-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {comment.body}
      </p>
    </article>
  );
}

export function TranscriptRow({
  item,
  ctx,
  actions,
  isLastNotice,
}: {
  item: DisplayItem;
  ctx: TranscriptContext;
  actions: TranscriptActions;
  isLastNotice: boolean;
}) {
  const [hover, setHover] = useState(false);
  switch (item.kind) {
    case "user":
      return (
        <div
          className="flex flex-col items-end gap-1"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <UserText text={item.text} />
          <Attachments assets={item.attachments} instanceId={ctx.instanceId} />
          <div className={cn("flex gap-1", !hover && "md:invisible")}>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => copy(item.text)}
              aria-label="Copy message"
            >
              <Copy />
            </Button>
            {actions.fork && item.forkAt && (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => actions.fork?.(item.forkAt!)}
                aria-label="Fork from here"
                title="Fork from here"
              >
                <GitFork />
              </Button>
            )}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="chat-md min-w-0 px-0.5">
          <Streamdown components={markdownComponents}>{item.text}</Streamdown>
        </div>
      );
    case "thinking":
      return (
        <Trace>
          <TraceCollapsible>
            <TraceCollapsibleTrigger>
              <TraceLine>
                <TraceTitle>Thinking</TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <p className="text-muted-foreground text-sm whitespace-pre-wrap">{item.text}</p>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      );
    case "report":
      return (
        <div className="bg-muted/60 flex gap-2 rounded-xl px-3 py-2 text-sm">
          <Bot className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">
              Subagent <span className={monoClass}>{item.from}</span> reported
            </p>
            <div className="chat-md min-w-0">
              <Streamdown components={markdownComponents}>{item.text}</Streamdown>
            </div>
          </div>
        </div>
      );
    case "job":
      return (
        <p
          className={cn(
            "flex items-start gap-2 text-sm",
            item.exitCode ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <SquareTerminal className="mt-0.5 size-4 shrink-0" />
          <span className="whitespace-pre-wrap">{item.text}</span>
        </p>
      );
    case "notice":
      return <Notice item={item} actions={actions} isLast={isLastNotice} />;
    case "turn": {
      const parts = [
        item.durationMs !== undefined ? `Worked for ${formatDuration(item.durationMs)}` : "Done",
        item.costUsd !== undefined ? formatCost(item.costUsd) : undefined,
      ].filter(Boolean);
      return (
        <p
          className="text-muted-foreground/80 flex items-center gap-1.5 text-xs"
          data-testid="turn-divider"
        >
          <CircleCheck className="size-3.5" aria-hidden />
          {parts.join(" · ")}
        </p>
      );
    }
    case "request":
      return <RequestRow item={item} actions={actions} />;
    case "tool":
      return <ToolRow call={item} ctx={ctx} />;
    case "tool-group":
      return <ToolGroupRow group={item} ctx={ctx} />;
  }
}

/** Text and thinking the model is streaming right now. */
export function StreamingTail({ text, thinking }: { text: string; thinking: string }) {
  if (text) {
    return (
      <div className="chat-md min-w-0 px-0.5">
        <Streamdown components={markdownComponents}>{text}</Streamdown>
      </div>
    );
  }
  if (thinking) {
    return (
      <p className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-wrap italic">
        {thinking}
      </p>
    );
  }
  return <TypingIndicator label="working" />;
}
