import { useState } from "react";
import { Link } from "react-router-dom";
import { Streamdown } from "streamdown";
import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  GitBranch,
  GitPullRequest,
  Pencil,
  Info,
  ListChecks,
  MessageCircle,
  MessageSquare,
  RotateCcw,
  ShieldQuestion,
  SquareTerminal,
  TriangleAlert,
  Wrench,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
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
import {
  describeTools,
  type DisplayItem,
  type ToolGroup,
  type WorkFold,
} from "../../lib/code/transcript";
import { parseReviewMessage, type SentComment } from "../../lib/code/comments";
import {
  parseAutofixRequest,
  splitProjectPreamble,
  splitReviewCard,
} from "../../../shared/code-messages";
import { formatDuration } from "../../lib/code/format";
import { PatchView, diffStats } from "./UnifiedDiff";

export interface TranscriptActions {
  recovery: RecoveryAction[];
  recover(action: RecoveryAction): void;
  rewind?: { turns: ReadonlySet<string>; edit(id: string): void; retry(id: string): void };
  respond(requestId: string, answer: RequestAnswer): Promise<void>;
}

export interface TranscriptContext {
  instanceId: string;
  rows: ThreadSummary[];
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

function SubagentStatus({ working, failed }: { working: boolean; failed: boolean }) {
  if (working) return <Spinner className="size-3.5 shrink-0" aria-label="Working" />;
  if (failed) return <CircleX className="text-destructive size-3.5 shrink-0" aria-label="Failed" />;
  return <CircleCheck className="text-muted-foreground size-3.5 shrink-0" aria-label="Done" />;
}

function SubagentResult({
  result,
  live,
  failed,
}: {
  result: string;
  live?: boolean;
  failed: boolean;
}) {
  if (live || failed) {
    return <Output title={live ? "Output (live)" : "Output"} value={result} destructive={failed} />;
  }
  return (
    <div className="bg-muted/40 max-h-96 overflow-y-auto overscroll-contain rounded-lg px-3 py-2 text-sm">
      <Streamdown components={markdownComponents}>{result}</Streamdown>
    </div>
  );
}

function subagentPrompt(call: ToolItem): string {
  const input = call.input && typeof call.input === "object" ? call.input : undefined;
  return input && "prompt" in input ? String((input as { prompt?: unknown }).prompt ?? "") : "";
}

function SubagentHead({
  title,
  prompt,
  working,
  failed,
  open,
  expandable,
}: {
  title: string;
  prompt: string;
  working: boolean;
  failed: boolean;
  open: boolean;
  expandable: boolean;
}) {
  return (
    <>
      <Bot className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Subagent</span>
          <span className={cn("truncate", monoClass)}>{title}</span>
          <SubagentStatus working={working} failed={failed} />
        </div>
        {prompt && !open && <p className="text-muted-foreground truncate text-xs">{prompt}</p>}
      </div>
      {expandable && (
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
      )}
    </>
  );
}

function OpenThreadLink({ threadId }: { threadId: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link to={threadPath(threadId)}>
        Open
        <ArrowUpRight />
      </Link>
    </Button>
  );
}

function SubagentRow({ call, ctx }: { call: ToolItem; ctx: TranscriptContext }) {
  const [open, setOpen] = useState(false);
  const child = call.child;
  const row = child ? ctx.rows.find((r) => r.id === child.threadId) : undefined;
  const prompt = subagentPrompt(call);
  const failed = failedTool(call);
  const result = call.output?.trim() ?? "";
  const expandable = Boolean(prompt || result);
  const head = (
    <SubagentHead
      title={child?.title ?? call.summary}
      prompt={prompt}
      working={Boolean(row?.working) || call.status === "running"}
      failed={failed}
      open={open}
      expandable={expandable}
    />
  );
  const link = child && <OpenThreadLink threadId={child.threadId} />;
  if (!expandable) {
    return (
      <div className="border-border flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2">
        {head}
        {link}
      </div>
    );
  }
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-border min-w-0 rounded-xl border"
      data-testid="code-subagent"
    >
      <div className="flex min-w-0 items-center gap-3 py-2 pr-3">
        <CollapsibleTrigger className="hover:bg-muted/40 -my-2 flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl py-2 pl-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {head}
        </CollapsibleTrigger>
        {link}
      </div>
      <CollapsibleContent className="space-y-2 px-3 pb-3">
        {result && <SubagentResult result={result} live={call.live} failed={failed} />}
        {prompt && <Output title="Prompt" value={prompt} />}
      </CollapsibleContent>
    </Collapsible>
  );
}

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
                  <PatchView
                    patch={call.diff.diff}
                    path={call.diff.path}
                    className="max-h-96 overflow-y-auto"
                  />
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
      <Images assets={call.images} instanceId={ctx.instanceId} />
    </div>
  );
}

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

function WorkFoldRow({
  fold,
  ctx,
  actions,
}: {
  fold: WorkFold;
  ctx: TranscriptContext;
  actions: TranscriptActions;
}) {
  const tools = fold.items.flatMap((item) =>
    item.kind === "tool" ? [item] : item.kind === "tool-group" ? item.tools : [],
  );
  const failed = tools.filter(failedTool).length;
  const label = [
    fold.durationMs !== undefined
      ? `Worked for ${formatDuration(fold.durationMs)}`
      : tools.length > 0
        ? describeTools(tools)
        : "Worked",
    fold.costUsd !== undefined ? formatCost(fold.costUsd) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Trace data-testid="code-work">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine className="text-xs">
            <TraceTitle>{label}</TraceTitle>
            {failed > 0 && (
              <TraceDescription className="text-destructive">· {failed} failed</TraceDescription>
            )}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="border-border mt-1 flex flex-col gap-4 border-l pl-4">
          {fold.items.map((item) => (
            <TranscriptRow
              key={item.id}
              item={item}
              ctx={ctx}
              actions={actions}
              isLastNotice={false}
            />
          ))}
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

function UserText({ text: sent }: { text: string }) {
  const project = splitProjectPreamble(sent);
  const review = project ? null : splitReviewCard(sent);
  const text = project ? project.message : review ? review.message : sent;
  return (
    <>
      {review && (
        <p
          aria-label="Pull request"
          className={cn("text-muted-foreground flex items-center gap-1.5 text-xs", monoClass)}
        >
          <GitPullRequest className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            Reviewing{" "}
            <span className="text-foreground">
              {review.repo}#{review.number}
            </span>
          </span>
        </p>
      )}
      {project && (
        <p
          aria-label="Branch"
          className={cn("text-muted-foreground flex items-center gap-1.5 text-xs", monoClass)}
        >
          <GitBranch className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            <span className="text-foreground">{project.branch}</span> from {project.base}
          </span>
          {project.setupFailed && (
            <span className="text-warning shrink-0">· setup script failed</span>
          )}
        </p>
      )}
      <MessageText text={text} />
    </>
  );
}

function MessageText({ text }: { text: string }) {
  if (!text) return null;
  const autofix = parseAutofixRequest(text);
  if (autofix) return <AutofixCard kind={autofix.kind} items={autofix.items} text={text} />;
  const review = parseReviewMessage(text);
  if (!review) {
    return (
      <div
        className={cn(
          USER_PILL,
          "max-w-[85%] rounded-xl text-sm leading-[22px] whitespace-pre-wrap",
        )}
      >
        {text}
      </div>
    );
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
        <div
          className={cn(
            USER_PILL,
            "max-w-[85%] rounded-xl text-sm leading-[22px] whitespace-pre-wrap",
          )}
        >
          {review.message}
        </div>
      )}
    </>
  );
}

function AutofixCard({
  kind,
  items,
  text,
}: {
  kind: "pass" | "final";
  items: Array<{ id: string; title: string }>;
  text: string;
}) {
  const [open, setOpen] = useState(false);
  const title = kind === "final" ? "Auto-fix final check" : "Auto-fix pass";
  return (
    <article
      aria-label={title}
      className="ring-foreground/10 bg-card w-full max-w-[85%] overflow-hidden rounded-xl text-sm ring-1"
    >
      <header className="flex items-center gap-1.5 px-3 pt-2 text-xs">
        <Wrench className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <span className="font-medium">{title}</span>
        <span className="flex-1" />
        <Button
          size="xs"
          variant="ghost"
          className="text-muted-foreground -mr-1.5"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? "Hide the full request" : "Show the full request"}
        </Button>
      </header>
      {items.length > 0 ? (
        <ul className="space-y-0.5 px-3 pt-1 pb-2">
          {items.map((item) => (
            <li key={item.id} className="truncate" title={item.title}>
              {item.title}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground px-3 pt-1 pb-2">
          {kind === "final"
            ? "A last review of the whole change, now that the checks are green."
            : "Fix what the checks and reviewers report."}
        </p>
      )}
      {open && (
        <pre
          className={cn(
            "text-muted-foreground border-border max-h-96 overflow-y-auto border-t px-3 py-2 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]",
            monoClass,
          )}
        >
          {text}
        </pre>
      )}
    </article>
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
            {actions.rewind?.turns.has(item.id) && (
              <>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => actions.rewind?.edit(item.id)}
                  aria-label="Edit this message and run again"
                  title="Edit and run again (files go back to before this turn)"
                >
                  <Pencil />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => actions.rewind?.retry(item.id)}
                  aria-label="Run this turn again"
                  title="Run this turn again"
                >
                  <RotateCcw />
                </Button>
              </>
            )}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="chat-md code-md min-w-0 px-0.5">
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
            <div className="chat-md code-md min-w-0">
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
    case "work":
      return <WorkFoldRow fold={item} ctx={ctx} actions={actions} />;
  }
}

export function StreamingTail({ text, thinking }: { text: string; thinking: string }) {
  if (text) {
    return (
      <div className="chat-md code-md min-w-0 px-0.5">
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
