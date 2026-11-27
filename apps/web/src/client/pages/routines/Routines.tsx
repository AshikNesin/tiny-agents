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
import { HookUrlDialog } from "./HookUrlDialog";

const AWAITING_POLL_MS = 4_000;

export function Routines() {
  const resource = useRoutines();
  const { refresh } = resource;
  const data =
    resource.status === "ready"
      ? resource.data
      : resource.status === "failed"
        ? (resource.last ?? null)
        : null;
  const routines = data?.routines ?? null;
  const runs = data?.runs ?? null;
  const mutations = useRoutineMutations();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hook, setHook] = useState<{ name: string; url: string } | null>(null);
  const confirm = useConfirm();
  const navigate = useNavigate();

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

  const showHook = async (routine: Routine) => {
    if (routine.hasHook) {
      const confirmed = await confirm({
        title: "Make a new webhook URL?",
        description: "The URL is shown only once. A new one stops the old one from working.",
        confirmLabel: "Make new URL",
      });
      if (!confirmed) return;
    }
    let url: string | undefined;
    const done = await act(
      routine.id,
      async () => {
        url = (await mutations.rotateHook.mutateAsync(routine.id)).url;
      },
      "hook",
    );
    if (done && url) setHook({ name: routine.name, url });
  };

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
      description="Run any bot on a schedule (once, daily, weekly, on an interval) or when a webhook is called. Times are in IST."
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
      {resource.status === "failed" ? (
        <EmptyState
          icon={CalendarClock}
          title="Couldn't load routines"
          description={resource.loadError}
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
                      busyId === routine.id + "resume" ||
                      busyId === routine.id + "hook")
                  }
                  onEdit={() => {
                    setEditing(routine);
                    setEditorOpen(true);
                  }}
                  onDelete={() => void remove(routine)}
                  onHook={() => void showHook(routine)}
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

          {routines.length > 1 && upcoming.length > 0 && <UpcomingRuns upcoming={upcoming} />}

          {runs !== null && runs.length > 0 && <RecentRuns runs={runs} />}
        </>
      )}

      <HookUrlDialog
        url={hook?.url ?? null}
        routineName={hook?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setHook(null);
        }}
      />

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
