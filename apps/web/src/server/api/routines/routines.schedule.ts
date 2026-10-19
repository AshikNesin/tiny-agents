/**
 * Routine schedule math, pure and DB-free: the discriminated schedule union,
 * IST next-occurrence computation, the missed-run grace window, and the
 * human-facing labels every surface (API, prompts, future UI) reuses.
 * IST-only by design (issue #18): one owner, one timezone, no DST.
 */
import { CronExpressionParser } from "cron-parser";
import cronstrue from "cronstrue";
import { z } from "zod";

/** The single timezone constant (PRD 5.2). Everything renders in this zone. */
export const TZ_IST = "Asia/Kolkata";

export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 1440;
export const MAX_ROUTINES = 50;
export const MAX_NAME_CHARS = 80;
export const MAX_PROMPT_CHARS = 20_000;

/** 5-field cron expressions only; 6-field (with seconds) are out of scope. */
const cronExpr = z
  .string()
  .trim()
  .min(1, "Cron expression is required")
  .refine((value) => value.split(/\s+/).length === 5, {
    message: "Use a 5-field cron expression (minute hour day-of-month month day-of-week)",
  })
  .refine(
    (value) => {
      try {
        CronExpressionParser.parse(value, { tz: TZ_IST });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Not a valid cron expression" },
  );

/** once: a single instant. Offset required so a bare wall-clock never implies UTC. */
const onceSchema = z.object({
  kind: z.literal("once"),
  at: z.string().refine((value) => z.iso.datetime({ offset: true }).safeParse(value).success, {
    message: "Provide an ISO datetime with an explicit offset (e.g. 2026-11-01T09:00:00+05:30)",
  }),
});

export const intervalSchema = z.object({
  kind: z.literal("interval"),
  minutes: z
    .number()
    .int()
    .min(MIN_INTERVAL_MINUTES, `Interval must be at least ${MIN_INTERVAL_MINUTES} minutes`)
    .max(MAX_INTERVAL_MINUTES, `Interval must be at most ${MAX_INTERVAL_MINUTES} minutes (24h)`),
});

const cronSchema = z.object({
  kind: z.literal("cron"),
  expr: cronExpr,
});

export const scheduleSchema = z.discriminatedUnion("kind", [
  onceSchema,
  cronSchema,
  intervalSchema,
]);

export type Schedule = z.infer<typeof scheduleSchema>;
export type OnceSchedule = z.infer<typeof onceSchema>;
export type CronSchedule = z.infer<typeof cronSchema>;
export type IntervalSchedule = z.infer<typeof intervalSchema>;

/**
 * Parse a stored/transported schedule value. Every boundary (API, job handler,
 * future toolkit) funnels through this, so an invalid schedule can never reach
 * the scheduling engine.
 */
export function parseSchedule(value: unknown): Schedule {
  return scheduleSchema.parse(value);
}

/** Parse without throwing; used where a 400 response or a skip is preferable. */
export function safeParseSchedule(value: unknown): Schedule | undefined {
  const result = scheduleSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/**
 * The next fire after `from`, as an absolute UTC instant.
 *
 * - once: the instant itself (even if already past; lateness is the fire
 *   handler's call, not the parser's).
 * - cron: cron-parser in IST. An expression whose next slot after `from` does
 *   not exist (Feb 29 on non-leap years) rolls to the next matching date.
 * - interval: `from + minutes`. The routine's createdAt anchors drift-free
 *   recurrence across restarts: each fire schedules the next from the
 *   occurrence just fired, not from wall-clock now.
 */
export function nextOccurrence(schedule: Schedule, from: Date): Date {
  switch (schedule.kind) {
    case "once":
      return new Date(schedule.at);
    case "cron":
      return CronExpressionParser.parse(schedule.expr, {
        currentDate: from,
        tz: TZ_IST,
      })
        .next()
        .toDate();
    case "interval":
      return new Date(from.getTime() + schedule.minutes * 60_000);
  }
}

/** Minutes between consecutive occurrences of a recurring schedule (once has none). */
export function periodMinutes(schedule: Schedule): number | undefined {
  if (schedule.kind === "interval") return schedule.minutes;
  if (schedule.kind !== "cron") return undefined;
  try {
    const from = new Date(0);
    const first = CronExpressionParser.parse(schedule.expr, {
      currentDate: from,
      tz: TZ_IST,
    });
    const a = first.next().toDate();
    const b = first.next().toDate();
    const minutes = Math.round((b.getTime() - a.getTime()) / 60_000);
    return minutes > 0 ? minutes : undefined;
  } catch {
    return undefined;
  }
}

/** Lateness grace: half the period, clamped to [5, 120] minutes (PRD 5.5). */
export function graceMinutes(periodMin: number): number {
  return Math.min(120, Math.max(5, Math.round(periodMin / 2)));
}

/**
 * Decide whether an overdue occurrence still fires. `once` always fires late
 * (a reminder at 9:05 is still useful); recurring schedules past their grace
 * are recorded missed.
 */
export function withinGrace(schedule: Schedule, scheduledFor: Date, now: Date): boolean {
  if (schedule.kind === "once") return true;
  const period = periodMinutes(schedule);
  if (period === undefined) return true;
  const lateMs = now.getTime() - scheduledFor.getTime();
  return lateMs <= graceMinutes(period) * 60_000;
}

/** Plain-English schedule sentence (cronstrue for cron; fixed wording otherwise). */
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

/** The prompt header a fired routine carries (PRD 5.4), with the occurrence pinned. */
export function composeRoutineLabel(
  name: string,
  scheduledFor: Date,
  lateByMinutes?: number,
): string {
  const late =
    lateByMinutes !== undefined && lateByMinutes > 0 ? ` (late by ${lateByMinutes}m)` : "";
  return `**Routine "${name}" (scheduled ${formatIst(scheduledFor)})${late}:**`;
}

/** The full text submitted into the bot's conversation. */
export function composeRoutinePrompt(
  name: string,
  prompt: string,
  scheduledFor: Date,
  lateByMinutes?: number,
): string {
  return `${composeRoutineLabel(name, scheduledFor, lateByMinutes)}\n${prompt}`;
}
