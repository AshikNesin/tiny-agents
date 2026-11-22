import type { Routine, Schedule } from "../../../shared/api/routines";
import {
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  TZ_IST,
  istInputFromAt,
  isValidCron,
  onceAtFromIstInput,
} from "../../../shared/routines-schedule";

export type ScheduleKind = "once" | "daily" | "weekly" | "interval" | "cron" | "webhook";

const TZ = TZ_IST;

const DEFAULT_IST_TIME = "09:00";

function defaultOnceInput(now = new Date()): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() + 24 * 60 * 60_000));
  return `${date}T${DEFAULT_IST_TIME}`;
}

export interface EditorForm {
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

export function formFromRoutine(routine: Routine): EditorForm {
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
  } else if (schedule.kind === "webhook") {
    kind = "webhook";
  } else if (schedule.kind === "interval") {
    kind = "interval";
    intervalMinutes = String(schedule.minutes);
  } else if (schedule.kind === "cron") {
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

export function compileSchedule(
  form: EditorForm,
): { schedule: Schedule; error?: undefined } | { schedule?: undefined; error: string } {
  switch (form.kind) {
    case "once": {
      if (!form.onceAt) return { error: "Pick a date and time (IST)" };
      const at = onceAtFromIstInput(form.onceAt);
      if (new Date(at).getTime() <= Date.now()) return { error: "Pick a time in the future" };
      return { schedule: { kind: "once", at } };
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
    case "webhook":
      return { schedule: { kind: "webhook" } };
  }
}

export function defaultForm(): EditorForm {
  return {
    botId: "",
    name: "",
    prompt: "",
    kind: "daily",
    onceAt: defaultOnceInput(),
    dailyTime: DEFAULT_IST_TIME,
    weeklyDay: "1",
    weeklyTime: DEFAULT_IST_TIME,
    intervalMinutes: "30",
    cronExpr: "",
  };
}

export function nameFromPrompt(prompt: string): string {
  const line = prompt.trim().split("\n")[0] ?? "";
  if (line.length <= 40) return line;
  const cut = line.slice(0, 40);
  const space = cut.lastIndexOf(" ");
  return `${space > 20 ? cut.slice(0, space) : cut}…`;
}
