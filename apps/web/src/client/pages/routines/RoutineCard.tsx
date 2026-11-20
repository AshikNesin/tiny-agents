import { Pencil, Play, Repeat, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Card } from "@groot/ui/card";
import { StatusBadge } from "@groot/ui/status-badge";
import { cn } from "@groot/ui/lib/utils";
import { Switch } from "../../components/ui/switch";
import type { Routine } from "../../../shared/api/routines";
import { formatIst } from "../../lib/routines-schedule";
import { ROUTINE_NEEDS_ATTENTION, routineState } from "../../../shared/machines/routine";

export function RoutineCard({
  routine,
  busy,
  onEdit,
  onDelete,
  onRunNow,
  onResume,
  onToggle,
}: {
  routine: Routine;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRunNow: () => void;
  onResume: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const state = routineState(routine);
  const autoPaused = state === "auto_paused";
  const blocked = state === "struggling";
  return (
    <Card>
      <div className="flex items-start gap-3 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Repeat className="size-4 shrink-0 text-muted-foreground" />
            <p className="truncate text-sm font-medium">{routine.name}</p>
            {ROUTINE_NEEDS_ATTENTION.has(state) && (
              <StatusBadge status="warning" label="Needs attention" className="shrink-0" />
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {routine.botName} · {routine.scheduleDescription}
          </p>
          {autoPaused ? (
            <p className="mt-1 text-xs text-warning">{routine.pausedReason}</p>
          ) : (
            <p
              className={cn(
                "mt-1 text-xs",
                routine.enabled ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {routine.enabled && routine.nextRunAt
                ? `Next run ${formatIst(routine.nextRunAt)}`
                : routine.done
                  ? "Done · edit to pick a new time"
                  : "Paused"}
            </p>
          )}
          {blocked && (
            <p className="mt-1 text-xs text-warning">
              {routine.blockedStreak === 1
                ? "The last run was blocked."
                : `The last ${routine.blockedStreak} runs were blocked.`}{" "}
              It pauses after 3 in a row.
            </p>
          )}
        </div>
        <Switch
          checked={routine.enabled}
          disabled={busy || routine.done}
          onCheckedChange={onToggle}
          aria-label={routine.enabled ? `Pause ${routine.name}` : `Resume ${routine.name}`}
        />
      </div>
      <div className="flex items-center gap-2 px-4 pb-4">
        {autoPaused && (
          <Button variant="outline" size="sm" onClick={onResume} disabled={busy}>
            <RotateCcw className="size-3.5" />
            Resume
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onRunNow} disabled={busy}>
          <Play className="size-3.5" />
          Run now
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="size-3.5" />
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </div>
    </Card>
  );
}
