import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  ListChecks,
  MessageCircle,
  SquareTerminal,
} from "lucide-react";
import { Button, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Markdown } from "../../lib/markdown";
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
import { CodeBlock, CodeBlockHeader, CodeBlockTitle } from "../../components/ui/code-block";
import { Spinner } from "../../components/ui/spinner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@groot/ui/collapsible";
import { threadPath, type ToolItem } from "../../lib/code/api";
import { describeTools, type ToolGroup } from "../../lib/code/transcript";
import { formatDuration } from "../../lib/format";
import { PatchView, diffStats } from "./UnifiedDiff";
import { Images, Output } from "./ToolOutput";
import type { TranscriptContext } from "./transcript-context";

export const failedTool = (call: ToolItem) =>
  call.status === "error" ||
  call.status === "denied" ||
  (call.exitCode !== undefined && call.exitCode !== 0);

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
      <Markdown>{result}</Markdown>
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
    <Button size="sm" variant="outline" render={<Link to={threadPath(threadId)} />}>
      Open
      <ArrowUpRight />
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

export function ToolRow({ call, ctx }: { call: ToolItem; ctx: TranscriptContext }) {
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

export function ToolGroupRow({ group, ctx }: { group: ToolGroup; ctx: TranscriptContext }) {
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
