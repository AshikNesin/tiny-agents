/**
 * The page's two lists of runs: the next five across all routines, and the
 * recent runs with their status, trigger, duration and output or error.
 */
import { CalendarDays, Clock, Zap } from "lucide-react";
import { Card } from "@groot/ui/card";
import { Badge } from "@groot/ui/badge";
import { StatusBadge } from "@groot/ui/status-badge";
import { listRowClass } from "@groot/ui/list-row";
import { cn } from "@groot/ui/lib/utils";
import { Section } from "@groot/shell/components/layout/Section";
import type { Routine, RoutineRun } from "../../../shared/api/routines";
import { markdownToPlainText } from "../../lib/plain-text";
import { formatIst } from "../../lib/routines-schedule";

const RUN_STATUS_VARIANT: Record<RoutineRun["status"], string> = {
  awaiting: "pending",
  succeeded: "success",
  blocked: "warning",
  failed: "failed",
  missed: "warning",
  cancelled: "cancelled",
};

/** Status words where the stored value doesn't read well. */
const RUN_STATUS_LABEL: Partial<Record<RoutineRun["status"], string>> = {
  blocked: "needs attention",
};

/** Seconds between two ISO strings, when both are present. */
function durationSeconds(run: RoutineRun): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const seconds = Math.round(
    (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000,
  );
  return seconds >= 0 ? seconds : null;
}

/** A run's token spend, short: "820 tokens", "42k tokens", "1.2M tokens". */
function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens} tokens`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k tokens`;
  return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
}

function formatDuration(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function UpcomingRuns({ upcoming }: { upcoming: Routine[] }) {
  return (
    <Section title="Upcoming" meta="next 5 across all routines">
      <Card className="divide-y overflow-hidden p-0">
        <ul role="list">
          {upcoming.map((routine) => (
            <li key={routine.id} className="flex items-center gap-3 px-4 py-3">
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{routine.name}</p>
                <p className="text-xs text-muted-foreground">
                  {routine.botName} · {routine.scheduleDescription}
                </p>
              </div>
              <span className="text-sm whitespace-nowrap">{formatIst(routine.nextRunAt!)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

export function RecentRuns({ runs }: { runs: RoutineRun[] }) {
  return (
    <Section title="Recent runs">
      <Card className="divide-y overflow-hidden p-0">
        <ul role="list">
          {runs.map((run) => (
            <li key={run.id} className={cn(listRowClass, "flex-col items-start")}>
              <div className="flex w-full items-center gap-3">
                <StatusBadge
                  status={RUN_STATUS_VARIANT[run.status]}
                  label={RUN_STATUS_LABEL[run.status] ?? run.status}
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {run.routineName ?? "Routine"}
                </span>
                <Badge variant="outline">
                  {run.trigger === "manual" ? (
                    <Zap className="size-3" />
                  ) : (
                    <Clock className="size-3" />
                  )}
                  {run.trigger}
                </Badge>
              </div>
              <p className="line-clamp-2 w-full text-xs text-muted-foreground">
                {formatIst(run.scheduledFor)}
                {durationSeconds(run) !== null &&
                  ` · took ${formatDuration(durationSeconds(run)!)}`}
                {run.tokens != null && run.tokens > 0 && ` · ${formatTokens(run.tokens)}`}
                {run.output && (
                  <>
                    {" · "}
                    <span className="align-middle">{markdownToPlainText(run.output)}</span>
                  </>
                )}
                {run.error && (
                  <>
                    {" · "}
                    <span
                      className={run.status === "blocked" ? "text-warning" : "text-destructive"}
                    >
                      {run.error}
                    </span>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}
