import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import { StatusBadge } from "@groot/ui/status-badge";
import { cn } from "@groot/ui/lib/utils";
import { markdownToPlainText } from "../lib/plain-text";
import { formatIst } from "../lib/routines-schedule";
import type { RoutineRunCard as RoutineRunCardData } from "../lib/chat-types";
import { Message } from "./ui/message";

const STATUS_VARIANT: Record<RoutineRunCardData["status"], string> = {
  succeeded: "success",
  failed: "failed",
  missed: "warning",
  cancelled: "cancelled",
};

/** Longer outputs start clamped; the card expands in place. */
const CLAMP_CHARS = 280;

/**
 * A finished routine run in its bot's chat (issue #63): the routine ran in a
 * conversation of its own, and only this result shows here. Rendered from
 * the run row, never sent to the model.
 */
export function RoutineRunCard({ run }: { run: RoutineRunCardData }) {
  const [expanded, setExpanded] = useState(false);
  const output = run.output ? markdownToPlainText(run.output) : "";
  const long = output.length > CLAMP_CHARS;
  return (
    <Message className="flex-col gap-1.5" data-testid="routine-run-card" data-status={run.status}>
      <div className="bg-bubble min-w-0 max-w-[92%] space-y-1.5 rounded-3xl px-4 py-3 md:max-w-[80%]">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <CalendarClock className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          <Link
            to="/routines"
            className="text-foreground/80 min-w-0 truncate font-medium hover:underline"
          >
            {run.routineName}
          </Link>
          <StatusBadge status={STATUS_VARIANT[run.status] ?? "pending"} label={run.status} />
          <span className="text-muted-foreground ml-auto shrink-0">
            {run.trigger === "manual" ? "Run now · " : ""}
            {formatIst(run.finishedAt)}
          </span>
        </div>
        {output && (
          <p className={cn("text-sm whitespace-pre-wrap", !expanded && long && "line-clamp-4")}>
            {output}
          </p>
        )}
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
        {run.error && <p className="text-destructive text-xs">{run.error}</p>}
      </div>
    </Message>
  );
}
