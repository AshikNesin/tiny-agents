import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity } from "lucide-react";
import { Button } from "@groot/ui/button";
import { EmptyState, ErrorState } from "@groot/ui/empty-state";
import { SkeletonList } from "@groot/ui/loading-skeleton";
import { listRowClass } from "@groot/ui/list-row";
import { metaLabelClass, monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import type { SideCall, TraceSession } from "../../../shared/api/traces";
import { tracesApi } from "../../lib/traces-api";
import { errorMessage } from "../../lib/errors";
import { useTraceList, useTraceSummary, type TraceListFilter } from "../../queries/traces";
import { formatCost, formatDuration, formatTokens } from "../../lib/format";
import { byDay, formatTime } from "./format";

const FILTERS: { value: TraceListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "chats", label: "Chats" },
  { value: "routine", label: "Routines" },
  { value: "delivery", label: "Bot to bot" },
  { value: "side", label: "Side-calls" },
];

export const KIND_LABEL: Record<TraceSession["kind"], string> = {
  chat: "Current chat",
  past_chat: "Past chat",
  routine: "Routine",
  delivery: "Bot to bot",
};

export const HARNESS_LABEL: Record<TraceSession["harness"], string> = {
  pi: "pi",
  "claude-plan": "Claude plan",
};

function Summary() {
  const summary = useTraceSummary();
  const data =
    summary.status === "ready"
      ? summary.data
      : summary.status === "failed"
        ? summary.last
        : undefined;
  if (!data) return null;
  return (
    <p className="text-muted-foreground text-sm" data-testid="traces-summary">
      Last 7 days · <span className="text-foreground">{formatCost(data.costUsd)}</span> ·{" "}
      {formatTokens(data.tokens)} tokens · {data.sessions} session
      {data.sessions === 1 ? "" : "s"} · {data.sideCalls} side-call
      {data.sideCalls === 1 ? "" : "s"}
    </p>
  );
}

function SessionRow({ session }: { session: TraceSession }) {
  const usage = session.usage;
  return (
    <li>
      <Link
        to={`/traces/${session.id}`}
        className={cn(listRowClass, "rounded-lg")}
        data-testid="trace-session"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{session.title}</p>
          <p className="text-muted-foreground truncate text-xs">
            {session.kind === "chat" ? "" : `${session.bot.name} · `}
            {KIND_LABEL[session.kind]}
            {session.harness === "claude-plan" ? ` · ${HARNESS_LABEL[session.harness]}` : ""}
            {usage?.models[0] ? (
              <>
                {" · "}
                <span className={monoClass}>{usage.models[0]}</span>
                {usage.models.length > 1 ? ` +${usage.models.length - 1}` : ""}
              </>
            ) : null}
          </p>
        </div>
        <div className="text-muted-foreground hidden shrink-0 text-right text-xs tabular-nums sm:block">
          {usage && usage.input + usage.output > 0
            ? `${formatTokens(usage.input + usage.cacheRead + usage.cacheWrite)} in · ${formatTokens(usage.output)} out`
            : "No usage reported"}
        </div>
        <div className="w-16 shrink-0 text-right text-sm tabular-nums">
          {usage && usage.costUsd > 0 ? formatCost(usage.costUsd) : ""}
        </div>
        <div className="text-muted-foreground w-16 shrink-0 text-right text-xs whitespace-nowrap tabular-nums">
          {formatTime(session.lastAt)}
        </div>
      </Link>
    </li>
  );
}

function SideCallRow({ call }: { call: SideCall }) {
  const failed = call.outcome !== "ok";
  return (
    <li className={listRowClass} data-testid="trace-side-call">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {call.purpose}
          {failed ? <span className="text-destructive"> · {call.outcome}</span> : null}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {call.bot ? `${call.bot.name} · ` : ""}
          <span className={monoClass}>{call.model ?? "unknown model"}</span>
          {call.durationMs !== null ? ` · ${formatDuration(call.durationMs)}` : ""}
          {call.error ? <span className="text-destructive"> · {call.error}</span> : null}
        </p>
      </div>
      <div className="text-muted-foreground hidden shrink-0 text-right text-xs tabular-nums sm:block">
        {formatTokens(call.inputTokens + call.cacheReadTokens + call.cacheWriteTokens)} in ·{" "}
        {formatTokens(call.outputTokens)} out
      </div>
      <div className="w-16 shrink-0 text-right text-sm tabular-nums">
        {call.costUsd > 0 ? formatCost(call.costUsd) : ""}
      </div>
      <div className="text-muted-foreground w-16 shrink-0 text-right text-xs whitespace-nowrap tabular-nums">
        {formatTime(call.createdAt)}
      </div>
    </li>
  );
}

function DayGroups<T>({
  items,
  at,
  render,
}: {
  items: T[];
  at: (item: T) => number;
  render: (item: T) => ReactNode;
}) {
  return (
    <div className="space-y-5">
      {byDay(items, at).map(([label, group]) => (
        <section key={label} aria-label={label}>
          <h2 className={cn(metaLabelClass, "px-4 pb-1 sm:px-5")}>{label}</h2>
          <ul className="divide-border/60 divide-y">{group.map(render)}</ul>
        </section>
      ))}
    </div>
  );
}

interface OlderPages {
  filter: TraceListFilter;
  sessions: TraceSession[];
  calls: SideCall[];
  next: number | null | undefined;
}

const emptyOlder = (filter: TraceListFilter): OlderPages => ({
  filter,
  sessions: [],
  calls: [],
  next: undefined,
});

export function TracesPage() {
  const [filter, setFilter] = useState<TraceListFilter>("all");
  const resource = useTraceList(filter);
  const data =
    resource.status === "ready"
      ? resource.data
      : resource.status === "failed"
        ? (resource.last ?? null)
        : null;
  const [older, setOlder] = useState<OlderPages>(() => emptyOlder(filter));
  const [loadingMore, setLoadingMore] = useState(false);
  const more = older.filter === filter ? older : emptyOlder(filter);
  const setMore = (update: (pages: OlderPages) => OlderPages) =>
    setOlder((prev) => update(prev.filter === filter ? prev : emptyOlder(filter)));

  const next = more.next === undefined ? (data?.next ?? null) : more.next;
  const loadMore = async () => {
    if (next === null || !data) return;
    setLoadingMore(true);
    try {
      if (data.kind === "side") {
        const page = await tracesApi.sideCalls({ before: next });
        setMore((m) => ({ ...m, calls: [...m.calls, ...page.calls], next: page.next }));
      } else {
        const page = await tracesApi.sessions({
          ...(filter !== "all" && filter !== "side" ? { kind: filter } : {}),
          before: next,
        });
        setMore((m) => ({ ...m, sessions: [...m.sessions, ...page.sessions], next: page.next }));
      }
    } catch (error) {
      setMore((m) => ({ ...m, next }));
      console.warn(errorMessage(error, "Failed to load more"));
    } finally {
      setLoadingMore(false);
    }
  };

  let body: ReactNode;
  if (resource.status === "failed") {
    body = (
      <ErrorState
        title={resource.loadError}
        action={
          <Button variant="outline" onClick={() => void resource.refresh()}>
            Try again
          </Button>
        }
      />
    );
  } else if (resource.status === "loading") {
    body = <SkeletonList />;
  } else if (resource.data.kind === "side") {
    const calls = [...resource.data.calls, ...more.calls];
    body =
      calls.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No side-calls yet"
          description="Memory capture, chat titles and auto-review show here when they run."
        />
      ) : (
        <DayGroups
          items={calls}
          at={(call) => call.createdAt}
          render={(call) => <SideCallRow key={call.id} call={call} />}
        />
      );
  } else {
    const sessions = [...resource.data.sessions, ...more.sessions];
    body =
      sessions.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No traces yet"
          description="Every model call a bot makes shows here, with its tokens and cost."
        />
      ) : (
        <DayGroups
          items={sessions}
          at={(session) => session.lastAt}
          render={(session) => <SessionRow key={session.id} session={session} />}
        />
      );
  }

  return (
    <PageLayout
      title="Traces"
      description="Every model call your bots make, with its tokens, cost and timing."
      maxWidth="4xl"
    >
      <div className="space-y-5">
        <Summary />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
          {FILTERS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={filter === option.value ? "secondary" : "ghost"}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {body}
        {data && next !== null && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Loading" : "Show older"}
            </Button>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
