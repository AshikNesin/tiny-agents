/**
 * Client-side schedule math for the Routines page (issue #18 phase B).
 * Deliberately mirrors the server's routines.schedule.ts (TZ, sentence
 * wording, preview counts) without importing server code: the schedule
 * union types come from routines-api.ts and the same libraries (cron-parser,
 * cronstrue) are browser-safe dependencies of @groot/web.
 */
import { CronExpressionParser } from "cron-parser";
import cronstrue from "cronstrue";
import type { Schedule } from "../../shared/api/routines";

/** The single timezone (PRD 5.2): everything renders in IST, no picker. */
export const TZ_IST = "Asia/Kolkata";

export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 1440;
export const MAX_NAME_CHARS = 80;
export const MAX_PROMPT_CHARS = 20_000;

/** IST wall-clock rendering, e.g. "Tue, 20 Oct 2026, 09:00 IST". */
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

/** Plain-English sentence, same wording as the server's describeSchedule. */
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
  }
}

/** Whether cron-parser accepts the expression in IST (5 fields, valid fields). */
export function isValidCron(expr: string): boolean {
  if (expr.split(/\s+/).length !== 5) return false;
  try {
    CronExpressionParser.parse(expr, { tz: TZ_IST });
    return true;
  } catch {
    return false;
  }
}

/**
 * The next fire after `from`, as an absolute instant; same semantics as the
 * server's nextOccurrence (once returns the instant itself, even if past).
 */
export function nextOccurrence(schedule: Schedule, from: Date): Date {
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

/** The next N fire times from `from`, for the editor's live preview. */
export function previewFireTimes(schedule: Schedule, from: Date, count = 3): Date[] {
  const times: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    cursor = nextOccurrence(schedule, cursor);
    times.push(cursor);
  }
  return times;
}

/**
 * datetime-local value ("2026-11-01T09:00", no offset) read as an IST
 * wall-clock. The explicit +05:30 keeps a bare wall time from implying UTC
 * on the server (the schedule union requires an offset).
 */
export function onceAtFromIstInput(value: string): string {
  return `${value}:00+05:30`;
}

/** Inverse helper for the editor: a stored `at` back to the IST input value. */
export function istInputFromAt(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  // en-CA gives ISO-like YYYY-MM-DD; a separate time part avoids the "24:00"
  // edge Intl can emit for end-of-day instants.
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
