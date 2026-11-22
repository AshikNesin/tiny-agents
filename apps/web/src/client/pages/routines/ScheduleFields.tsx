import { Input } from "@groot/ui/input";
import { Label } from "@groot/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@groot/ui/tabs";
import { monoClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import {
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  istInputFromAt,
} from "../../../shared/routines-schedule";
import type { EditorForm, ScheduleKind } from "./routine-form";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const SCHEDULE_TABS: { value: ScheduleKind; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "interval", label: "Interval" },
  { value: "cron", label: "Cron" },
  { value: "webhook", label: "Webhook" },
];

const TIME_OPTIONS: string[] = Array.from(
  { length: 24 * 4 },
  (_, i) =>
    `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
);

export function ScheduleFields({
  form,
  set,
}: {
  form: EditorForm;
  set: <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Schedule</Label>
      <Tabs value={form.kind} onValueChange={(v) => set("kind", v as ScheduleKind)}>
        <TabsList className="flex w-full">
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
            min={istInputFromAt(new Date().toISOString())}
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
              <SelectContent position="popper" className="max-h-72">
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
      {form.kind === "webhook" && (
        <p className="text-xs text-muted-foreground">
          Runs whenever its URL gets a POST, with the body as its input. Save, then use Webhook URL
          on the routine to get the URL.
        </p>
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
        <SelectContent position="popper" className="max-h-72">
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
