import { CalendarDays, Clock, Zap } from "lucide-react";
import { Card } from "@groot/ui/card";
import { Badge } from "@groot/ui/badge";
import { listRowClass } from "@groot/ui/list-row";
import { cn } from "@groot/ui/lib/utils";
import { Section } from "@groot/shell/components/layout/Section";
import type { Routine, RoutineRun } from "../../../shared/api/routines";
import { routineRunLabels } from "../../../shared/machines/routine-run";
import { StatusBadge } from "../../components/StatusBadge";
import { formatDuration, formatTokens } from "../../lib/format";
import { markdownToPlainText } from "../../lib/plain-text";
import { formatIst } from "../../../shared/routines-schedule";

function durationMs(run: RoutineRun): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  return ms >= 0 ? ms : null;
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
                <StatusBadge status={run.status} labels={routineRunLabels} />
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
                {durationMs(run) !== null &&
                  ` · took ${formatDuration(durationMs(run)!, { precision: "seconds" })}`}
                {run.tokens != null && run.tokens > 0 && ` · ${formatTokens(run.tokens)} tokens`}
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
