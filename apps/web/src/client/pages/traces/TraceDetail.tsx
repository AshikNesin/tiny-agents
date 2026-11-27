import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  BrainIcon,
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  ListCollapseIcon,
  MessageSquareIcon,
  SlidersHorizontalIcon,
  SquareTerminalIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";
import { Breadcrumbs } from "@groot/ui/breadcrumb";
import { Button } from "@groot/ui/button";
import { Checkbox } from "@groot/ui/checkbox";
import { ErrorState } from "@groot/ui/empty-state";
import { SkeletonList } from "@groot/ui/loading-skeleton";
import { metaLabelClass, monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import type {
  TraceEvent,
  TraceSession,
  TraceSessionDetail,
  TraceTurn,
} from "../../../shared/api/traces";
import { Markdown } from "../../lib/markdown";
import { stepTitle, type ToolLabelCatalog } from "../../lib/tool-call-text";
import { useToolLabels } from "../../lib/use-tool-labels";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "../../components/ui/trace";
import { useTraceSession } from "../../queries/traces";
import { countEvents, shows, toolDisplayName, type FilterKey } from "./filters";
import { formatCost, formatDuration, formatTime, formatTokens, dayLabel } from "./format";
import { HARNESS_LABEL, KIND_LABEL } from "./Traces";

function chatLink(session: TraceSession): string | undefined {
  if (session.kind === "chat") return `/chats/${session.bot.id}`;
  if (session.kind === "past_chat" && session.chatId) {
    return `/chats/${session.bot.id}/history/${session.chatId}`;
  }
  if (session.kind === "routine") return "/routines";
  return undefined;
}

const NORMAL_STOPS = new Set(["stop", "toolUse", "done", "streaming"]);

function Totals({ detail }: { detail: TraceSessionDetail }) {
  const { usage } = detail.trace;
  const steps = detail.trace.turns.flatMap((turn) => turn.steps);
  const calls = steps.filter((step) => step.type === "llm");
  const tools = steps.filter((step) => step.type === "tool");
  const failed =
    calls.filter((step) => step.error || !NORMAL_STOPS.has(step.stopReason)).length +
    tools.filter((step) => step.error).length;
  const input = usage.input + usage.cacheRead + usage.cacheWrite;
  const cached = input > 0 ? Math.round((usage.cacheRead / input) * 100) : 0;
  const reported = input + usage.output > 0;
  const parts = [
    reported ? formatCost(usage.costUsd) : "Usage not reported",
    ...(reported
      ? [
          `${formatTokens(input)} in${cached > 0 ? ` (${cached}% cached)` : ""}`,
          `${formatTokens(usage.output)} out`,
        ]
      : []),
    `${calls.length} model call${calls.length === 1 ? "" : "s"}`,
    `${tools.length} tool call${tools.length === 1 ? "" : "s"}`,
  ];
  return (
    <p className="text-muted-foreground text-sm tabular-nums" data-testid="trace-totals">
      {parts.join(" · ")}
      {failed > 0 ? <span className="text-destructive"> · {failed} failed</span> : null}
    </p>
  );
}

function FilterRow({
  label,
  icon,
  count,
  checked,
  onChange,
  nested = false,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  nested?: boolean;
}) {
  return (
    <label
      className={cn(
        "hover:text-foreground flex cursor-pointer items-center gap-2 py-1.5 text-sm",
        nested && "pl-6",
        checked ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      <span className="border-border mx-1 min-w-4 flex-1 border-b border-dotted" />
      <span className="tabular-nums">{count}</span>
    </label>
  );
}

function toolIcon(name: string) {
  if (/bash|command|exec|shell|terminal|run/i.test(name)) return <SquareTerminalIcon />;
  if (/edit|write|patch|replace/i.test(name)) return <FilePenIcon />;
  if (/read|file|list|grep|glob/i.test(name)) return <FileTextIcon />;
  if (/web|fetch|search|browse|page|url/i.test(name)) return <GlobeIcon />;
  return <WrenchIcon />;
}

function Filters({
  turns,
  selected,
  onToggle,
}: {
  turns: readonly TraceTurn[];
  selected: ReadonlySet<FilterKey>;
  onToggle: (key: FilterKey, checked: boolean) => void;
}) {
  const counts = useMemo(() => countEvents(turns), [turns]);
  return (
    <div role="group" aria-label="Filter the transcript" data-testid="trace-filters">
      <FilterRow
        label="Prompts"
        icon={<UserIcon />}
        count={counts.prompt}
        checked={selected.has("prompt")}
        onChange={(checked) => onToggle("prompt", checked)}
      />
      <FilterRow
        label="Agent responses"
        icon={<MessageSquareIcon />}
        count={counts.response}
        checked={selected.has("response")}
        onChange={(checked) => onToggle("response", checked)}
      />
      <FilterRow
        label="Thinking"
        icon={<BrainIcon />}
        count={counts.thinking}
        checked={selected.has("thinking")}
        onChange={(checked) => onToggle("thinking", checked)}
      />
      <FilterRow
        label="Tool calls"
        icon={<WrenchIcon />}
        count={counts.tool}
        checked={selected.has("tool")}
        onChange={(checked) => onToggle("tool", checked)}
      />
      {counts.tools.map(([name, count]) => (
        <FilterRow
          key={name}
          nested
          label={toolDisplayName(name)}
          icon={toolIcon(name)}
          count={count}
          checked={selected.has("tool") || selected.has(`tool:${name}`)}
          onChange={(checked) => onToggle(`tool:${name}`, checked)}
        />
      ))}
      <FilterRow
        label="Compaction"
        icon={<ListCollapseIcon />}
        count={counts.compaction}
        checked={selected.has("compaction")}
        onChange={(checked) => onToggle("compaction", checked)}
      />
    </div>
  );
}

const preClass = cn(
  monoClass,
  "bg-muted/50 text-foreground max-h-96 overflow-auto rounded-md px-3 py-2 text-xs whitespace-pre-wrap break-words",
);

const RAW_ARGS = new Set(["command", "cmd", "script", "code", "query"]);

function inputText(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 1 && RAW_ARGS.has(entries[0]![0]) && typeof entries[0]![1] === "string") {
    return entries[0]![1];
  }
  return JSON.stringify(input, null, 2);
}

function ToolEvent({
  event,
  labels,
}: {
  event: Extract<TraceEvent, { type: "tool" }>;
  labels: ToolLabelCatalog;
}) {
  const title = stepTitle({ id: "", name: event.name, args: event.input, status: "done" }, labels);
  const hasInput = Object.keys(event.input).length > 0;
  return (
    <TraceCollapsible data-testid="trace-tool">
      <TraceCollapsibleTrigger>
        <TraceLine status={event.error ? "error" : undefined}>
          <TraceIcon>{toolIcon(event.name)}</TraceIcon>
          <TraceTitle>{title}</TraceTitle>
          {event.error ? (
            <TraceDescription className="text-destructive">failed</TraceDescription>
          ) : null}
          {event.durationMs !== undefined ? (
            <TraceDescription>{formatDuration(event.durationMs)}</TraceDescription>
          ) : null}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="space-y-2">
        <p className={metaLabelClass}>Input</p>
        <pre className={preClass}>{hasInput ? inputText(event.input) : "No input"}</pre>
        <p className={metaLabelClass}>Output</p>
        <pre className={cn(preClass, event.error && "text-destructive")}>
          {event.output === undefined ? "No result" : event.output || "Empty"}
        </pre>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function EventRow({ event, labels }: { event: TraceEvent; labels: ToolLabelCatalog }) {
  switch (event.type) {
    case "prompt":
      return (
        <div
          className="bg-muted/60 rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words"
          data-testid="trace-prompt"
        >
          {event.peer ? <p className={cn(metaLabelClass, "mb-1")}>From a bot</p> : null}
          {event.text || <span className="text-muted-foreground">No input</span>}
        </div>
      );
    case "response":
      return (
        <div className="chat-md min-w-0 py-1 text-sm" data-testid="trace-response">
          <Markdown>{event.text}</Markdown>
        </div>
      );
    case "thinking":
      return (
        <TraceCollapsible data-testid="trace-thinking">
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon>
                <BrainIcon />
              </TraceIcon>
              <TraceTitle>Thought</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="text-sm whitespace-pre-wrap">
            {event.redacted ? "Redacted by the provider." : event.text}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      );
    case "tool":
      return <ToolEvent event={event} labels={labels} />;
    case "compaction":
      return (
        <TraceCollapsible data-testid="trace-compaction">
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon>
                <ListCollapseIcon />
              </TraceIcon>
              <TraceTitle>Context summarized</TraceTitle>
              <TraceDescription>{event.reason}</TraceDescription>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="text-sm whitespace-pre-wrap">
            {event.summary || "No summary stored."}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      );
  }
}

function turnMeta(turn: TraceTurn, index: number): string {
  const calls = turn.steps.filter((step) => step.type === "llm");
  let input = 0;
  let output = 0;
  let cost = 0;
  for (const step of turn.steps) {
    if (step.type === "compaction" || !step.usage) continue;
    input += step.usage.input + step.usage.cacheRead + step.usage.cacheWrite;
    output += step.usage.output;
    cost += step.usage.costUsd;
  }
  const last = turn.steps.findLast((step) => step.type !== "compaction");
  const end = last ? last.at + (last.durationMs ?? 0) : undefined;
  const models = [...new Set(calls.map((step) => step.model))];
  return [
    `Turn ${index + 1}`,
    `${dayLabel(turn.at)} ${formatTime(turn.at)}`,
    ...(end && end > turn.at ? [formatDuration(end - turn.at)] : []),
    ...(models.length ? [models.join(", ")] : []),
    `${calls.length} model call${calls.length === 1 ? "" : "s"}`,
    ...(input + output > 0 ? [`${formatTokens(input)} in · ${formatTokens(output)} out`] : []),
    ...(cost > 0 ? [formatCost(cost)] : []),
  ].join(" · ");
}

function Transcript({
  turns,
  selected,
}: {
  turns: readonly TraceTurn[];
  selected: ReadonlySet<FilterKey>;
}) {
  const labels = useToolLabels();
  const shown = turns
    .map((turn, index) => ({
      turn,
      index,
      events: turn.events.filter((event) => shows(selected, event)),
    }))
    .filter(({ events }) => events.length > 0);
  if (shown.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {turns.length === 0 ? "Nothing in this session yet." : "Nothing matches these filters."}
      </p>
    );
  }
  return (
    <ol className="space-y-8">
      {shown.map(({ turn, index, events }) => (
        <li key={index} className="space-y-2" data-testid="trace-turn">
          {events.map((event, i) => (
            <EventRow key={i} event={event} labels={labels} />
          ))}
          <p className="text-muted-foreground/80 pt-1 text-xs tabular-nums">
            {turnMeta(turn, index)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function SessionTrace({ detail }: { detail: TraceSessionDetail }) {
  const [selected, setSelected] = useState<ReadonlySet<FilterKey>>(new Set());
  const toggle = (key: FilterKey, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  const { turns } = detail.trace;
  const filters = <Filters turns={turns} selected={selected} onToggle={toggle} />;
  return (
    <div className="space-y-4">
      <Totals detail={detail} />
      <details className="border-border/60 rounded-xl border px-3 py-1 lg:hidden">
        <summary className="text-muted-foreground flex cursor-pointer list-none items-center gap-2 py-1.5 text-sm">
          <SlidersHorizontalIcon className="size-4" />
          Filter{selected.size > 0 ? ` · ${selected.size} on` : ""}
        </summary>
        <div className="pb-2">{filters}</div>
      </details>
      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-4">{filters}</div>
        </aside>
        <Transcript turns={turns} selected={selected} />
      </div>
    </div>
  );
}

export function TraceDetailPage() {
  const { id = "" } = useParams();
  const { data, loadError, refresh } = useTraceSession(id);
  const session = data?.session;
  const link = session ? chatLink(session) : undefined;
  const breadcrumb = (
    <Breadcrumbs page={session?.title ?? "Trace"}>
      <Link to="/traces">Traces</Link>
    </Breadcrumbs>
  );
  return (
    <PageLayout
      title={session?.title ?? "Trace"}
      breadcrumb={breadcrumb}
      backTo="/traces"
      maxWidth="6xl"
      description={
        session ? (
          <>
            {session.bot.name} · {KIND_LABEL[session.kind]} · {HARNESS_LABEL[session.harness]}
            {session.usage?.models.length ? (
              <>
                {" · "}
                <span className={monoClass}>{session.usage.models.join(", ")}</span>
              </>
            ) : null}
          </>
        ) : undefined
      }
      actions={
        link ? (
          <Button variant="outline" size="sm" render={<Link to={link} />}>
            Open chat
          </Button>
        ) : undefined
      }
    >
      {loadError ? (
        <ErrorState
          title={loadError}
          action={
            <Button variant="outline" onClick={() => void refresh()}>
              Try again
            </Button>
          }
        />
      ) : !data ? (
        <SkeletonList />
      ) : (
        <SessionTrace detail={data} />
      )}
    </PageLayout>
  );
}
