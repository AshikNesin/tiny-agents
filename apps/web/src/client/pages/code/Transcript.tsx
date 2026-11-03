/**
 * The Code page transcript (issue #143): one renderer per Shelley tool, so a
 * developer reads a turn the way they would in Shelley — the command and its
 * live output, the diff a patch made, the subagent it started.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Streamdown } from "streamdown";
import {
  ArrowUpRight,
  Bot,
  CircleCheck,
  CircleX,
  Copy,
  GitFork,
  Info,
  ListChecks,
  MessageCircle,
  RotateCcw,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { markdownComponents } from "../../lib/markdown";
import { TypingIndicator, USER_PILL } from "../../components/ChatMessageView";
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
import { shelleyApi, type ShelleyConversation } from "../../lib/shelley/api";
import {
  describeTools,
  type DisplayItem,
  type ToolGroup,
  type ToolItem,
  type TranscriptItem,
} from "../../lib/shelley/transcript";
import { PatchView, diffStats } from "./UnifiedDiff";

export interface TranscriptActions {
  retry(): void;
  resume(): void;
  continueWith(): void;
  fork(messageId: string): void;
}

export function formatDuration(ms: number): string {
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
  call.status === "error" || (call.exitCode !== undefined && call.exitCode !== 0);

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

function Images({ urls }: { urls: string[] }) {
  const resolved = urls.map((u) => shelleyApi.imageUrl(u)).filter((u): u is string => Boolean(u));
  if (resolved.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {resolved.map((src) => (
        <a key={src} href={src} target="_blank" rel="noreferrer" className="block">
          <img
            src={src}
            alt="Tool output"
            loading="lazy"
            className="border-border max-h-64 max-w-full rounded-lg border object-contain"
          />
        </a>
      ))}
    </div>
  );
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif)$/i;

/** Uploaded files referenced in a message: images inline, others as links. */
function Attachments({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;
  const images = paths.filter((p) => IMAGE_FILE.test(p));
  const files = paths.filter((p) => !IMAGE_FILE.test(p));
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-1">
      <Images urls={images.map((p) => `/api/read?path=${encodeURIComponent(p)}`)} />
      {files.map((p) => (
        <a
          key={p}
          href={shelleyApi.fileUrl(p)}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "text-muted-foreground hover:text-foreground truncate text-xs underline",
            monoClass,
          )}
        >
          {p.split("/").pop()}
        </a>
      ))}
    </div>
  );
}

function SubagentRow({ call, rows }: { call: ToolItem; rows: ShelleyConversation[] }) {
  const child = call.subagent;
  const row = child ? rows.find((r) => r.conversation_id === child.conversationId) : undefined;
  const slug = child?.slug ?? call.summary;
  const prompt =
    call.input && typeof call.input === "object" && "prompt" in call.input
      ? String((call.input as { prompt?: unknown }).prompt ?? "")
      : "";
  return (
    <div className="border-border flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2">
      <Bot className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Subagent</span>
          <span className={cn("truncate", monoClass)}>{slug}</span>
          {row?.working ? (
            <Spinner className="size-3.5" aria-label="Working" />
          ) : call.status === "running" ? null : (
            <CircleCheck className="text-muted-foreground size-3.5" aria-label="Idle" />
          )}
        </div>
        {prompt && <p className="text-muted-foreground truncate text-xs">{prompt}</p>}
      </div>
      {child && (
        <Button asChild size="sm" variant="outline">
          <Link to={`/code/${child.conversationId}`}>
            Open
            <ArrowUpRight />
          </Link>
        </Button>
      )}
    </div>
  );
}

function ToolRow({ call, rows }: { call: ToolItem; rows: ShelleyConversation[] }) {
  if (call.toolKind === "subagent") return <SubagentRow call={call} rows={rows} />;
  const input =
    call.input && typeof call.input === "object"
      ? (call.input as Record<string, unknown>)
      : undefined;
  if (call.toolKind === "message_user" && typeof input?.text === "string") {
    return (
      <div className="bg-muted/60 flex gap-2 rounded-xl px-3 py-2 text-sm">
        <MessageCircle className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <p className="whitespace-pre-wrap">{input.text}</p>
      </div>
    );
  }
  if (call.toolKind === "message_parent" && typeof input?.text === "string") {
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
    call.toolKind === "bash" || call.toolKind === "patch" || input === undefined
      ? ""
      : JSON.stringify(call.input, null, 2);
  const command =
    call.toolKind === "bash" && typeof input?.command === "string" ? input.command : "";
  const failed = failedTool(call);
  const hasDetail = Boolean(command || argsJson || call.output || call.diff || call.images.length);

  const line = (
    <TraceLine status={call.status === "running" ? "running" : failed ? "error" : undefined}>
      <TraceIcon>
        {call.status === "running" ? (
          <Spinner className="size-3.5" />
        ) : failed ? (
          <CircleX />
        ) : call.toolKind === "bash" ? (
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
          <TraceCollapsible defaultOpen={call.status === "running" && call.toolKind === "bash"}>
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
      <Images urls={call.images} />
    </div>
  );
}

/** Finished tool calls folded into one line ("Ran 3 commands, edited 2 files"). */
function ToolGroupRow({ group, rows }: { group: ToolGroup; rows: ShelleyConversation[] }) {
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
              <ToolRow key={item.key} call={item} rows={rows} />
            ) : (
              <p
                key={item.key}
                className="text-muted-foreground text-sm whitespace-pre-wrap italic"
              >
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
      <span className="min-w-0 flex-1 whitespace-pre-wrap">{item.text}</span>
      {isLast && item.retryable && (
        <Button size="xs" variant="outline" onClick={actions.retry}>
          <RotateCcw />
          Retry
        </Button>
      )}
      {isLast && item.refusal && (
        <Button size="xs" variant="outline" onClick={actions.continueWith}>
          Try another model
        </Button>
      )}
    </div>
  );
}

export function TranscriptRow({
  item,
  rows,
  actions,
  isLastNotice,
}: {
  item: DisplayItem;
  rows: ShelleyConversation[];
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
          {item.text && (
            <div className={cn(USER_PILL, "max-w-[85%] whitespace-pre-wrap")}>{item.text}</div>
          )}
          <Attachments paths={item.attachments} />
          <div className={cn("flex gap-1", !hover && "md:invisible")}>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => copy(item.text)}
              aria-label="Copy message"
            >
              <Copy />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => actions.fork(item.messageId)}
              aria-label="Fork from here"
              title="Fork from here"
            >
              <GitFork />
            </Button>
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
    case "tool":
      return <ToolRow call={item} rows={rows} />;
    case "tool-group":
      return <ToolGroupRow group={item} rows={rows} />;
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
