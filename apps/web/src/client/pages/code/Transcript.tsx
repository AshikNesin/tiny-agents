import { useState } from "react";
import {
  Bot,
  CircleCheck,
  Copy,
  Info,
  Pencil,
  RotateCcw,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import { Button, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Markdown } from "../../lib/markdown";
import { TypingIndicator } from "../../components/ui/transcript-parts";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from "../../components/ui/trace";
import type { RecoveryAction, TranscriptItem } from "../../lib/code/api";
import { describeTools, type DisplayItem, type WorkFold } from "../../lib/code/transcript";
import { formatCost, formatDuration } from "../../lib/format";
import { RequestRow } from "./RequestRow";
import { copy } from "./ToolOutput";
import { ToolGroupRow, ToolRow, failedTool } from "./ToolRow";
import type { TranscriptActions, TranscriptContext } from "./transcript-context";
import { Attachments, UserText } from "./UserMessage";

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
          <Markdown>{item.text}</Markdown>
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
              <Markdown>{item.text}</Markdown>
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
        <Markdown streaming>{text}</Markdown>
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
