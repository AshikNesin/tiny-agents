import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, ChevronDown } from "lucide-react";
import { cn } from "@groot/ui/lib/utils";
import { markdownToPlainText } from "../lib/plain-text";
import { formatIst, TZ_IST } from "../../shared/routines-schedule";
import { routineRunLabels } from "../../shared/machines/routine-run";
import { MachineStatusBadge } from "./MachineStatusBadge";
import type { RoutineRunCard } from "../lib/chat-types";

const timeOfDay = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ_IST,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const blockedRun = (run: RoutineRunCard) => run.status === "blocked";
const failedRun = (run: RoutineRunCard) => run.status !== "succeeded" && !blockedRun(run);

export function RoutineRuns({ runs }: { runs: RoutineRunCard[] }) {
  const [open, setOpen] = useState(false);
  const latest = runs[runs.length - 1];
  const names = new Set(runs.map((run) => run.routineName));
  const failed = runs.filter(failedRun).length;
  const blocked = runs.filter(blockedRun).length;
  return (
    <div data-testid="routine-runs" className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={formatIst(latest.finishedAt)}
        className="text-muted-foreground hover:text-foreground hover:bg-accent/50 inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
      >
        <CalendarClock className="size-3 shrink-0" aria-hidden />
        <span className="truncate">
          {names.size === 1 ? latest.routineName : `${names.size} routines`}
        </span>
        <span aria-hidden>·</span>
        {runs.length === 1 ? (
          <MachineStatusBadge plain status={latest.status} labels={routineRunLabels} />
        ) : (
          <>
            <span>ran {runs.length}×</span>
            {failed > 0 && <span className="text-destructive">{failed} failed</span>}
            {blocked > 0 && (
              <span className="text-warning">
                {blocked} need{blocked === 1 ? "s" : ""} attention
              </span>
            )}
          </>
        )}
        <span aria-hidden>·</span>
        <span className="shrink-0">
          {runs.length > 1 ? "last " : ""}
          {timeOfDay.format(new Date(latest.finishedAt))}
        </span>
        <ChevronDown
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <div className="bg-bubble w-full max-w-[92%] space-y-3 rounded-2xl px-4 py-3 text-xs md:max-w-[80%]">
          {[...runs].reverse().map((run) => (
            <RunDetail key={run.id} run={run} showName={names.size > 1} />
          ))}
          <Link to="/routines" className="text-muted-foreground hover:text-foreground block">
            Open routines
          </Link>
        </div>
      )}
    </div>
  );
}

function RunDetail({ run, showName }: { run: RoutineRunCard; showName: boolean }) {
  const output = run.output ? markdownToPlainText(run.output) : "";
  return (
    <div className="space-y-1" data-testid="routine-run" data-status={run.status}>
      <p className="text-muted-foreground">
        {timeOfDay.format(new Date(run.finishedAt))}
        {showName ? ` · ${run.routineName}` : ""}
        {" · "}
        <MachineStatusBadge plain status={run.status} labels={routineRunLabels} />
        {run.trigger === "manual" ? " · run now" : ""}
      </p>
      {output && <p className="text-foreground text-sm whitespace-pre-wrap">{output}</p>}
      {run.error && (
        <p className={blockedRun(run) ? "text-warning" : "text-destructive"}>{run.error}</p>
      )}
    </div>
  );
}
