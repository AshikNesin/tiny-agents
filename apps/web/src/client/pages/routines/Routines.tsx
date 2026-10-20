/**
 * Routines page (issue #18 phase B, PRD 5.8): upcoming runs, active
 * schedules, recent executions, and the editor dialog with a live
 * next-3-runs preview. All times render in IST; there is no timezone picker.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  CalendarClock,
  CalendarDays,
  Clock,
  Pencil,
  Play,
  Plus,
  Repeat,
  Trash2,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Textarea } from "@groot/ui/textarea";
import { Label } from "@groot/ui/label";
import { Card } from "@groot/ui/card";
import { Badge } from "@groot/ui/badge";
import { EmptyState } from "@groot/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@groot/ui/tabs";
import { SkeletonList } from "@groot/ui/loading-skeleton";
import { StatusBadge } from "@groot/ui/status-badge";
import { metaLabelClass, monoClass } from "@groot/ui/typography";
import { listRowClass } from "@groot/ui/list-row";
import { cn } from "@groot/ui/lib/utils";
import { useConfirm } from "@groot/ui/primitives";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { Section } from "@groot/shell/components/layout/Section";
import { Switch } from "../../components/ui/switch";
import { botsApi, type BotListEntry } from "../../lib/bots-api";
import { routinesApi, type Routine, type RoutineRun, type Schedule } from "../../lib/routines-api";
import {
  MAX_INTERVAL_MINUTES,
  MAX_NAME_CHARS,
  MAX_PROMPT_CHARS,
  MIN_INTERVAL_MINUTES,
  TZ_IST,
  describeSchedule,
  formatIst,
  istInputFromAt,
  isValidCron,
  onceAtFromIstInput,
  previewFireTimes,
} from "../../lib/routines-schedule";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const RUN_STATUS_VARIANT: Record<RoutineRun["status"], string> = {
  awaiting: "pending",
  succeeded: "success",
  failed: "failed",
  missed: "warning",
  cancelled: "cancelled",
};

/** Prefer the server's error message (Boom) over axios's generic text. */
function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "response" in error) {
    const message = (error as { response?: { data?: { error?: { message?: string } } } }).response
      ?.data?.error?.message;
    if (message) return message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Seconds between two ISO strings, when both are present. */
function durationSeconds(run: RoutineRun): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const seconds = Math.round(
    (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000,
  );
  return seconds >= 0 ? seconds : null;
}

function formatDuration(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function Routines() {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [runs, setRuns] = useState<RoutineRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = useConfirm();

  const refresh = useCallback(async () => {
    try {
      const [list, recent] = await Promise.all([routinesApi.list(), routinesApi.recentRuns(10)]);
      setRoutines(list);
      setRuns(recent.runs);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error, "Failed to load routines"));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    if (await act(routine.id, () => routinesApi.remove(routine.id), "remove")) {
      toast.success("Routine deleted");
    }
  };

  const runNow = (routine: Routine) =>
    act(routine.id, () => routinesApi.runNow(routine.id), "run").then(() => {
      toast.success("Run started");
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
      ) : (
        <>
          <Section title="Upcoming" meta="next 5 across all routines">
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No scheduled runs. Enabled routines show their next run here.
              </p>
            ) : (
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
                      <span className="text-sm whitespace-nowrap">
                        {formatIst(routine.nextRunAt!)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Section>

          <Section
            title="Schedules"
            meta={`${routines.length} total · ${routines.filter((r) => r.enabled).length} enabled`}
          >
            {routines.length === 0 ? (
              <EmptyState
                icon={Repeat}
                title="No routines yet"
                description="Schedule a bot to run a prompt on a schedule, or just once."
                action={
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
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {routines.map((routine) => (
                  <RoutineCard
                    key={routine.id}
                    routine={routine}
                    busy={
                      busyId !== null &&
                      (busyId === routine.id + "run" ||
                        busyId === routine.id + "remove" ||
                        busyId === routine.id + "toggle")
                    }
                    onEdit={() => {
                      setEditing(routine);
                      setEditorOpen(true);
                    }}
                    onDelete={() => void remove(routine)}
                    onRunNow={() => void runNow(routine)}
                    onToggle={(enabled) =>
                      void act(
                        routine.id,
                        () => routinesApi.update(routine.id, { enabled }),
                        "toggle",
                      )
                    }
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title="Recent executions">
            {runs === null ? (
              <SkeletonList rows={3} leading="square" />
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No runs yet. "Run now" fires a routine immediately and records it here.
              </p>
            ) : (
              <Card className="divide-y overflow-hidden p-0">
                <ul role="list">
                  {runs.map((run) => (
                    <li key={run.id} className={cn(listRowClass, "flex-col items-start")}>
                      <div className="flex w-full items-center gap-3">
                        <StatusBadge status={RUN_STATUS_VARIANT[run.status]} label={run.status} />
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
                      <p className="w-full text-xs text-muted-foreground">
                        {formatIst(run.scheduledFor)}
                        {durationSeconds(run) !== null &&
                          ` · took ${formatDuration(durationSeconds(run)!)}`}
                        {run.output && (
                          <>
                            {" · "}
                            <span className="align-middle">{run.output}</span>
                          </>
                        )}
                        {run.error && (
                          <>
                            {" · "}
                            <span className="text-destructive">{run.error}</span>
                          </>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Section>
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

function RoutineCard({
  routine,
  busy,
  onEdit,
  onDelete,
  onRunNow,
  onToggle,
}: {
  routine: Routine;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRunNow: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <Card>
      <div className="flex items-start gap-3 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Repeat className="size-4 shrink-0 text-muted-foreground" />
            <p className="truncate text-sm font-medium">{routine.name}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {routine.botName} · {routine.scheduleDescription}
          </p>
          <p
            className={cn(
              "mt-1 text-xs",
              routine.enabled ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {routine.enabled && routine.nextRunAt
              ? `Next run ${formatIst(routine.nextRunAt)}`
              : "Paused"}
          </p>
        </div>
        <Switch
          checked={routine.enabled}
          disabled={busy}
          onCheckedChange={onToggle}
          aria-label={routine.enabled ? `Pause ${routine.name}` : `Resume ${routine.name}`}
        />
      </div>
      <div className="flex items-center gap-2 px-4 pb-4">
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

type ScheduleKind = "once" | "daily" | "weekly" | "interval" | "cron";

const SCHEDULE_TABS: { value: ScheduleKind; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "interval", label: "Interval" },
  { value: "cron", label: "Custom cron" },
];

const TZ = TZ_IST;

/** Default time-of-day for a new daily/weekly preset. */
const DEFAULT_IST_TIME = "09:00";

/** datetime-local default for a new once schedule: tomorrow 09:00 IST. */
function defaultOnceInput(now = new Date()): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() + 24 * 60 * 60_000));
  return `${date}T${DEFAULT_IST_TIME}`;
}

/** Time options 00:00 to 23:45 in 15-minute steps (144 options render fine). */
const TIME_OPTIONS: string[] = Array.from(
  { length: 24 * 4 },
  (_, i) =>
    `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
);

interface EditorForm {
  botId: string;
  name: string;
  prompt: string;
  kind: ScheduleKind;
  onceAt: string;
  dailyTime: string;
  weeklyDay: string;
  weeklyTime: string;
  intervalMinutes: string;
  cronExpr: string;
}

function formFromRoutine(routine: Routine): EditorForm {
  const schedule = routine.schedule;
  let kind: ScheduleKind = "cron";
  let onceAt = defaultOnceInput();
  let dailyTime = DEFAULT_IST_TIME;
  let weeklyDay = "1";
  let weeklyTime = DEFAULT_IST_TIME;
  let intervalMinutes = "30";
  let cronExpr = "";
  if (schedule.kind === "once") {
    kind = "once";
    onceAt = istInputFromAt(schedule.at) || defaultOnceInput();
  } else if (schedule.kind === "interval") {
    kind = "interval";
    intervalMinutes = String(schedule.minutes);
  } else if (schedule.kind === "cron") {
    // Presets are a create-time convenience: an existing cron stays on the
    // Custom tab rather than being guessed apart.
    kind = "cron";
    cronExpr = schedule.expr;
    const daily = schedule.expr.match(/^(\d+) (\d+) \* \* \*$/);
    if (daily) {
      kind = "daily";
      dailyTime = `${daily[2].padStart(2, "0")}:${daily[1].padStart(2, "0")}`;
    }
    const weekly = schedule.expr.match(/^(\d+) (\d+) \* \* (\d)$/);
    if (weekly) {
      kind = "weekly";
      weeklyDay = weekly[4];
      weeklyTime = `${weekly[2].padStart(2, "0")}:${weekly[1].padStart(2, "0")}`;
    }
  }
  return {
    botId: routine.botId,
    name: routine.name,
    prompt: routine.prompt,
    kind,
    onceAt,
    dailyTime,
    weeklyDay,
    weeklyTime,
    intervalMinutes,
    cronExpr,
  };
}

/** Compile the editor form into the wire schedule, or an error message. */
function compileSchedule(
  form: EditorForm,
): { schedule: Schedule; error?: undefined } | { schedule?: undefined; error: string } {
  switch (form.kind) {
    case "once": {
      if (!form.onceAt) return { error: "Pick a date and time (IST)" };
      return { schedule: { kind: "once", at: onceAtFromIstInput(form.onceAt) } };
    }
    case "daily": {
      const [hour, minute] = form.dailyTime.split(":").map(Number);
      return { schedule: { kind: "cron", expr: `${minute} ${hour} * * *` } };
    }
    case "weekly": {
      const [hour, minute] = form.weeklyTime.split(":").map(Number);
      return { schedule: { kind: "cron", expr: `${minute} ${hour} * * ${form.weeklyDay}` } };
    }
    case "interval": {
      const minutes = Number(form.intervalMinutes);
      if (
        !Number.isInteger(minutes) ||
        minutes < MIN_INTERVAL_MINUTES ||
        minutes > MAX_INTERVAL_MINUTES
      ) {
        return {
          error: `Interval must be ${MIN_INTERVAL_MINUTES} to ${MAX_INTERVAL_MINUTES} minutes`,
        };
      }
      return { schedule: { kind: "interval", minutes } };
    }
    case "cron": {
      const expr = form.cronExpr.trim();
      if (!expr) return { error: "Cron expression is required" };
      if (!isValidCron(expr)) {
        return {
          error: "Use a 5-field cron expression (minute hour day-of-month month day-of-week)",
        };
      }
      return { schedule: { kind: "cron", expr } };
    }
  }
}

function RoutineEditor({
  open,
  routine,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  routine: Routine | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [bots, setBots] = useState<BotListEntry[] | null>(null);
  const [form, setForm] = useState<EditorForm>(() => defaultForm());
  const [saving, setSaving] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void botsApi
      .list()
      .then((list) => setBots(list.length > 0 ? list : []))
      .catch(() => setBots([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (routine) {
      if (routine.id === loadedId) return;
      setLoadedId(routine.id);
      setForm(formFromRoutine(routine));
    } else {
      setLoadedId(null);
      setForm(defaultForm());
    }
    // The form resets per dialog open so a create never inherit the
    // previously edited routine's values.
  }, [open, routine, loadedId]);

  const compiled = compileSchedule(form);
  const preview = useMemo(() => {
    if (!compiled.schedule) return null;
    try {
      // A once schedule has one fire time; three identical rows would be noise.
      const count = compiled.schedule.kind === "once" ? 1 : 3;
      return {
        sentence: describeSchedule(compiled.schedule),
        times: previewFireTimes(compiled.schedule, new Date(), count).map((time) =>
          formatIst(time),
        ),
      };
    } catch {
      return null;
    }
  }, [compiled.schedule]);

  const set = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (bots === null || bots.length === 0) {
      toast.error("Create a bot first");
      return;
    }
    if (!form.botId || !form.name.trim() || !form.prompt.trim()) {
      toast.error("Bot, name, and prompt are required");
      return;
    }
    if (!compiled.schedule) {
      toast.error(compiled.error);
      return;
    }
    setSaving(true);
    try {
      const base = {
        botId: form.botId,
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        schedule: compiled.schedule,
      };
      if (routine) await routinesApi.update(routine.id, base);
      else await routinesApi.create(base);
      toast.success(routine ? "Routine saved" : "Routine created");
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save routine"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{routine ? "Edit routine" : "New routine"}</DialogTitle>
          <DialogDescription>
            Times are read in IST. The preview shows the next 3 runs before you save.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Bot</Label>
            <Select value={form.botId} onValueChange={(v) => set("botId", v)}>
              <SelectTrigger aria-label="Bot" className="w-full">
                <SelectValue placeholder={bots === null ? "Loading bots…" : "Pick a bot"} />
              </SelectTrigger>
              <SelectContent>
                {(bots ?? []).map((bot) => (
                  <SelectItem key={bot.id} value={bot.id}>
                    {bot.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="routine-name">Name</Label>
            <Input
              id="routine-name"
              value={form.name}
              maxLength={MAX_NAME_CHARS}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. weekday-digest"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="routine-prompt">Prompt</Label>
            <Textarea
              id="routine-prompt"
              rows={4}
              value={form.prompt}
              maxLength={MAX_PROMPT_CHARS}
              onChange={(e) => set("prompt", e.target.value)}
              placeholder="What should the bot do each run?"
            />
          </div>

          <div className="space-y-2">
            <Label>Schedule</Label>
            <Tabs value={form.kind} onValueChange={(v) => set("kind", v as ScheduleKind)}>
              <TabsList className="flex w-full flex-wrap">
                {SCHEDULE_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {form.kind === "once" && (
              <div className="space-y-1.5">
                <Input
                  type="datetime-local"
                  aria-label="Run at (IST)"
                  value={form.onceAt}
                  onChange={(e) => set("onceAt", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Read as an IST wall time.</p>
              </div>
            )}
            {form.kind === "daily" && (
              <TimeSelect
                label="Time (IST)"
                value={form.dailyTime}
                onChange={(v) => set("dailyTime", v)}
              />
            )}
            {form.kind === "weekly" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Day</Label>
                  <Select value={form.weeklyDay} onValueChange={(v) => set("weeklyDay", v)}>
                    <SelectTrigger aria-label="Day of week" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS_OF_WEEK.map((day, index) => (
                        <SelectItem key={day} value={String(index)}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <TimeSelect
                  label="Time (IST)"
                  value={form.weeklyTime}
                  onChange={(v) => set("weeklyTime", v)}
                />
              </div>
            )}
            {form.kind === "interval" && (
              <div className="space-y-1.5">
                <Input
                  type="number"
                  inputMode="numeric"
                  aria-label="Interval minutes"
                  min={MIN_INTERVAL_MINUTES}
                  max={MAX_INTERVAL_MINUTES}
                  step={1}
                  value={form.intervalMinutes}
                  onChange={(e) => set("intervalMinutes", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Every {form.intervalMinutes || "…"} minutes, {MIN_INTERVAL_MINUTES} to{" "}
                  {MAX_INTERVAL_MINUTES} allowed.
                </p>
              </div>
            )}
            {form.kind === "cron" && (
              <div className="space-y-1.5">
                <Input
                  aria-label="Cron expression"
                  placeholder="0 9 * * 1-5"
                  className={cn(monoClass, "w-full")}
                  value={form.cronExpr}
                  onChange={(e) => set("cronExpr", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  5-field cron (minute hour day-of-month month day-of-week), read in IST.
                </p>
              </div>
            )}
          </div>

          {/* Acceptance criterion (issue #18): the next 3 runs are visible
              before saving. */}
          <div className="rounded-lg bg-muted/40 px-3 py-3">
            <p className={cn(metaLabelClass, "mb-1.5")}>Preview</p>
            {compiled.schedule && preview ? (
              <>
                <p className="text-sm">{preview.sentence}</p>
                <ul className="mt-1.5 space-y-0.5">
                  {preview.times.map((time) => (
                    <li key={time} className="text-xs text-muted-foreground">
                      {time}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{compiled.error}</p>
            )}
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || !compiled.schedule || !form.name.trim() || !form.prompt.trim()}
          >
            {routine ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TimeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TIME_OPTIONS.map((time) => (
            <SelectItem key={time} value={time}>
              {time}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function defaultForm(): EditorForm {
  return {
    botId: "",
    name: "",
    prompt: "",
    kind: "interval",
    onceAt: defaultOnceInput(),
    dailyTime: DEFAULT_IST_TIME,
    weeklyDay: "1",
    weeklyTime: DEFAULT_IST_TIME,
    intervalMinutes: "30",
    cronExpr: "",
  };
}
