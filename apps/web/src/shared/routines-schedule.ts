import { CronExpressionParser } from "cron-parser";
import cronstrue from "cronstrue";
import type { ClockSchedule, Schedule } from "./api/routines";

export const TZ_IST = "Asia/Kolkata";

export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 1440;
export const MAX_NAME_CHARS = 80;
export const MAX_PROMPT_CHARS = 20_000;

export function formatIst(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ_IST,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/(\d{2}:\d{2})$/, "$1 IST");
}

export function describeSchedule(schedule: Schedule): string {
  switch (schedule.kind) {
    case "once":
      return `Once, ${formatIst(schedule.at)}`;
    case "cron":
      return cronstrue.toString(schedule.expr, { use24HourTimeFormat: true });
    case "interval": {
      const minutes = schedule.minutes;
      if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return hours === 1 ? "Every hour" : `Every ${hours} hours`;
      }
      return `Every ${minutes} minutes`;
    }
    case "webhook":
      return "When its webhook URL is called";
  }
}

export function isClockSchedule(schedule: Schedule): schedule is ClockSchedule {
  return schedule.kind !== "webhook";
}

export function isValidCron(expr: string): boolean {
  if (expr.split(/\s+/).length !== 5) return false;
  try {
    CronExpressionParser.parse(expr, { tz: TZ_IST });
    return true;
  } catch {
    return false;
  }
}

export function nextOccurrence(schedule: ClockSchedule, from: Date): Date {
  switch (schedule.kind) {
    case "once":
      return new Date(schedule.at);
    case "cron":
      return CronExpressionParser.parse(schedule.expr, { currentDate: from, tz: TZ_IST })
        .next()
        .toDate();
    case "interval":
      return new Date(from.getTime() + schedule.minutes * 60_000);
  }
}

export function previewFireTimes(schedule: Schedule, from: Date, count = 3): Date[] {
  if (!isClockSchedule(schedule)) return [];
  const times: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    cursor = nextOccurrence(schedule, cursor);
    times.push(cursor);
  }
  return times;
}

export function onceAtFromIstInput(value: string): string {
  return `${value}:00+05:30`;
}

export function istInputFromAt(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ_IST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return time === "24:00" ? "" : `${day}T${time}`;
}
