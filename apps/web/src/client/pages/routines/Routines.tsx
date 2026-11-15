/**
 * Routines page (issue #18 phase B, PRD 5.8): upcoming runs, active
 * schedules, recent executions, and the editor dialog with a live
 * next-3-runs preview. All times render in IST; there is no timezone picker.
 * A run that could not do its job shows as "Needs attention" in amber, and
 * a routine the app paused after blocked runs says why (issue #87). The
 * page holds the list and its actions; the card, the run lists and the
 * editor are beside it.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { CalendarClock, Plus, Repeat } from "lucide-react";
import { Button } from "@groot/ui/button";
import { EmptyState } from "@groot/ui/empty-state";
import { SkeletonList } from "@groot/ui/loading-skeleton";
import { useConfirm } from "@groot/ui/primitives";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { Section } from "@groot/shell/components/layout/Section";
import type { Routine } from "../../../shared/api/routines";
import { useRoutineMutations, useRoutines } from "../../queries/routines";
import { errorMessage } from "../../lib/errors";
import { RoutineCard } from "./RoutineCard";
import { RoutineEditor } from "./RoutineEditor";
import { RecentRuns, UpcomingRuns } from "./RoutineRunLists";

/** How often the page checks back while a run is still awaiting its result. */
const AWAITING_POLL_MS = 4_000;

export function Routines() {
  const { data, loadError, refresh } = useRoutines();
  const routines = data?.routines ?? null;
  const runs = data?.runs ?? null;
  const mutations = useRoutineMutations();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = useConfirm();
  const navigate = useNavigate();

  // A run in flight settles in the bot's chat, not here: check back until it
  // has, so Recent runs doesn't say "awaiting" until the next reload.
  const awaiting = runs?.some((run) => run.status === "awaiting") ?? false;
  useEffect(() => {
    if (!awaiting) return;
    const timer = setInterval(() => void refresh(), AWAITING_POLL_MS);
    return () => clearInterval(timer);
  }, [awaiting, refresh]);

  const upcoming = useMemo(
    () =>
      (routines ?? [])
        .filter((routine) => routine.enabled && routine.nextRunAt)
        .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())
        .slice(0, 5),
    [routines],
  );

  /** Run an action with a busy marker; true when it completed. */
  const act = async (id: string, action: () => Promise<unknown>, pending: string) => {
    setBusyId(id + pending);
    try {
      await action();
      await refresh();
      return true;
    } catch (error) {
      toast.error(errorMessage(error, "Routine action failed"));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (routine: Routine) => {
    const confirmed = await confirm({
      title: `Delete "${routine.name}"?`,
      description: "The routine and its run history are permanently deleted.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    if (await act(routine.id, () => mutations.remove.mutateAsync(routine.id), "remove")) {
      toast.success("Routine deleted");
    }
  };

  // A run posts into the bot's chat, so point there.
  const runNow = (routine: Routine) =>
    act(routine.id, () => mutations.runNow.mutateAsync(routine.id), "run").then((ok) => {
      if (!ok) return;
      toast.success("Run started", {
        description: `${routine.botName} replies in its chat.`,
        action: { label: "Open chat", onClick: () => navigate(`/chats/${routine.botId}`) },
      });
    });

  return (
    <PageLayout
      title="Routines"
      description="Run any bot on a schedule: once, daily, weekly, or on an interval. Times are in IST."
      maxWidth="4xl"
      actions={
        <Button
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          <Plus className="size-4" />
          New routine
        </Button>
      }
    >
      {loadError ? (
        <EmptyState
          icon={CalendarClock}
          title="Couldn't load routines"
          description={loadError}
          variant="destructive"
          action={
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : routines === null ? (
        <SkeletonList rows={4} leading="circle" secondaryLine />
      ) : routines.length === 0 ? (
        // One calm empty state: Upcoming and Recent runs have nothing to
        // say until a routine exists. The header holds the action.
        <EmptyState
          icon={Repeat}
          title="No routines yet"
          description="Schedule a bot to run a prompt on a schedule, or just once."
        />
      ) : (
        <>
          <Section
            title="Schedules"
            meta={`${routines.length} total · ${routines.filter((r) => r.enabled).length} enabled`}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {routines.map((routine) => (
                <RoutineCard
                  key={routine.id}
                  routine={routine}
                  busy={
                    busyId !== null &&
                    (busyId === routine.id + "run" ||
                      busyId === routine.id + "remove" ||
                      busyId === routine.id + "toggle" ||
                      busyId === routine.id + "resume")
                  }
                  onEdit={() => {
                    setEditing(routine);
                    setEditorOpen(true);
                  }}
                  onDelete={() => void remove(routine)}
                  onRunNow={() => void runNow(routine)}
                  onResume={() =>
                    void act(routine.id, () => mutations.resume.mutateAsync(routine.id), "resume")
                  }
                  onToggle={(enabled) =>
                    void act(
                      routine.id,
                      () => mutations.update.mutateAsync({ id: routine.id, input: { enabled } }),
                      "toggle",
                    )
                  }
                />
              ))}
            </div>
          </Section>

          {/* With one routine its card already says when it runs next. */}
          {routines.length > 1 && upcoming.length > 0 && <UpcomingRuns upcoming={upcoming} />}

          {runs !== null && runs.length > 0 && <RecentRuns runs={runs} />}
        </>
      )}

      <RoutineEditor
        open={editorOpen}
        routine={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
          setEditorOpen(open);
        }}
        onSaved={async () => {
          setEditorOpen(false);
          setEditing(null);
          await refresh();
        }}
      />
    </PageLayout>
  );
}
