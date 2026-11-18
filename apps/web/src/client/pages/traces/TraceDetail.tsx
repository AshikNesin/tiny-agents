/**
 * One session's trace (issue #363): its totals, then each turn's input
 * preview and the model and tool calls that answered it, one compact row per
 * call. The full messages stay in the chat; this page shows metadata only.
 */
import { Link, useParams } from "react-router-dom";
import { Breadcrumbs } from "@groot/ui/breadcrumb";
import { Button } from "@groot/ui/button";
import { ErrorState } from "@groot/ui/empty-state";
import { SkeletonList } from "@groot/ui/loading-skeleton";
import { StatTile } from "@groot/ui/stat-tile";
import { metaLabelClass, monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import type {
  TraceSession,
  TraceSessionDetail,
  TraceStep,
  TraceTurn,
} from "../../../shared/api/traces";
import { useTraceSession } from "../../queries/traces";
import { formatCost, formatDuration, formatTime, formatTokens, dayLabel } from "./format";
import { HARNESS_LABEL, KIND_LABEL } from "./Traces";

/** Where the session's messages can be read in full. */
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
  return (
    <div className="border-border/60 grid grid-cols-3 gap-y-1 rounded-xl border py-1 sm:grid-cols-6">
      <StatTile
        className="px-4 py-2"
        label="Cost"
        value={reported ? formatCost(usage.costUsd) : "n/a"}
      />
      <StatTile
        className="px-4 py-2"
        label="Input"
        value={
          <>
            {reported ? formatTokens(input) : "n/a"}
            {reported && cached > 0 ? (
              <span className="text-muted-foreground text-xs font-normal"> {cached}% cached</span>
            ) : null}
          </>
        }
      />
      <StatTile
        className="px-4 py-2"
        label="Output"
        value={reported ? formatTokens(usage.output) : "n/a"}
      />
      <StatTile className="px-4 py-2" label="Model calls" value={calls.length} />
      <StatTile className="px-4 py-2" label="Tool calls" value={tools.length} />
      <StatTile
        className="px-4 py-2"
        label="Failed"
        value={failed}
        {...(failed > 0 ? { valueClassName: "text-destructive" } : {})}
      />
    </div>
  );
}

function usageText(step: Extract<TraceStep, { type: "llm" }>): string {
  if (!step.usage) return "usage not reported";
  const { input, cacheRead, cacheWrite, output } = step.usage;
  const parts = [`${formatTokens(input + cacheRead + cacheWrite)} in`];
  if (cacheRead > 0) parts.push(`${formatTokens(cacheRead)} cached`);
  parts.push(`${formatTokens(output)} out`);
  return parts.join(" · ");
}

function StepRow({ step }: { step: TraceStep }) {
  if (step.type === "compaction") {
    return (
      <li className="text-muted-foreground px-3 py-1.5 text-xs">
        Context summarized ({step.reason})
      </li>
    );
  }
  return step.type === "tool" ? <ToolRow step={step} /> : <CallRow step={step} />;
}

function ToolRow({ step }: { step: Extract<TraceStep, { type: "tool" }> }) {
  return (
    <li
      className="text-muted-foreground flex items-center gap-2 py-1.5 pr-3 pl-7 text-xs"
      data-testid="trace-tool"
    >
      <span className={cn(monoClass, "min-w-0 truncate", step.error && "text-destructive")}>
        {step.name}
      </span>
      {step.error ? <span className="text-destructive">failed</span> : null}
      <span className="ml-auto shrink-0 tabular-nums">
        {step.usage ? `${formatCost(step.usage.costUsd)} · ` : ""}
        {step.durationMs !== undefined ? formatDuration(step.durationMs) : ""}
      </span>
    </li>
  );
}

function CallRow({ step }: { step: Extract<TraceStep, { type: "llm" }> }) {
  const unusual = !NORMAL_STOPS.has(step.stopReason);
  return (
    <li className="space-y-0.5 px-3 py-1.5" data-testid="trace-call">
      <div className="flex items-center gap-2 text-sm">
        <span className={cn(monoClass, "min-w-0 truncate")}>{step.model}</span>
        {step.thinkingLevel && step.thinkingLevel !== "off" ? (
          <span className="text-muted-foreground text-xs">{step.thinkingLevel}</span>
        ) : null}
        {unusual ? (
          <span
            className={cn(
              "text-xs",
              step.stopReason === "length" ? "text-warning" : "text-destructive",
            )}
          >
            {step.stopReason}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 tabular-nums">
          {step.usage ? formatCost(step.usage.costUsd) : ""}
        </span>
      </div>
      <p className="text-muted-foreground flex flex-wrap gap-x-1 text-xs tabular-nums">
        <span>{formatTime(step.at)}</span>
        <span>· {usageText(step)}</span>
        {step.durationMs !== undefined ? <span>· {formatDuration(step.durationMs)}</span> : null}
        {step.toolCalls.length > 0 ? (
          <span>
            · asked for {step.toolCalls.length} tool{step.toolCalls.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </p>
      {step.error ? <p className="text-destructive text-xs">{step.error}</p> : null}
    </li>
  );
}

function TurnCard({ turn, index }: { turn: TraceTurn; index: number }) {
  const cost = turn.steps.reduce(
    (sum, step) => sum + (step.type !== "compaction" ? (step.usage?.costUsd ?? 0) : 0),
    0,
  );
  const last = turn.steps.findLast((step) => step.type !== "compaction");
  const end = last ? last.at + (last.durationMs ?? 0) : undefined;
  return (
    <section className="border-border/60 rounded-xl border" data-testid="trace-turn">
      <header className="border-border/60 space-y-0.5 border-b px-3 py-2">
        <p className={metaLabelClass}>
          Turn {index + 1} · {dayLabel(turn.at)} {formatTime(turn.at)}
          {end && end > turn.at ? ` · ${formatDuration(end - turn.at)}` : ""}
          {cost > 0 ? ` · ${formatCost(cost)}` : ""}
        </p>
        <p className="line-clamp-2 text-sm">
          {turn.peer ? <span className="text-muted-foreground">From a bot: </span> : null}
          {turn.input || <span className="text-muted-foreground">No input</span>}
        </p>
      </header>
      <ul className="py-1">
        {turn.steps.map((step, i) => (
          <StepRow key={i} step={step} />
        ))}
      </ul>
    </section>
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
      maxWidth="4xl"
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
          <Button variant="outline" size="sm" asChild>
            <Link to={link}>Open chat</Link>
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
        <div className="space-y-4">
          <Totals detail={data} />
          {data.trace.turns.length === 0 ? (
            <p className="text-muted-foreground text-sm">No model calls in this session yet.</p>
          ) : (
            [...data.trace.turns]
              .map((turn, index) => ({ turn, index }))
              .reverse()
              .map(({ turn, index }) => <TurnCard key={index} turn={turn} index={index} />)
          )}
        </div>
      )}
    </PageLayout>
  );
}
