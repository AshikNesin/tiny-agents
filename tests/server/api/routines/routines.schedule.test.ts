import { describe, expect, it } from "vite-plus/test";
import type { ClockSchedule } from "../../../../apps/web/src/shared/api/routines";
import {
  TZ_IST,
  composeRoutineLabel,
  composeRoutinePrompt,
  describeSchedule,
  formatIst,
  graceMinutes,
  nextOccurrence,
  parseSchedule,
  periodMinutes,
  scheduleSchema,
  withinGrace,
} from "../../../../apps/web/src/server/api/routines/routines.schedule";

const FROM = new Date("2026-10-20T10:00:00.000Z");

const clockSchedule = (value: unknown) => parseSchedule(value) as ClockSchedule;

describe("nextOccurrence (cron, IST)", () => {
  it("fires 00:30 IST on the previous UTC day (19:00 UTC)", () => {
    const schedule = clockSchedule({ kind: "cron", expr: "30 0 * * *" });
    const next = nextOccurrence(schedule, FROM);
    expect(next.toISOString()).toBe("2026-10-20T19:00:00.000Z");
  });

  it("computes weekday 09:00 IST from an afternoon-IST moment", () => {
    const schedule = clockSchedule({ kind: "cron", expr: "0 9 * * 1-5" });
    const next = nextOccurrence(schedule, FROM);
    expect(next.toISOString()).toBe("2026-10-21T03:30:00.000Z");
  });

  it("treats an exact-slot `from` as already fired and returns the following slot", () => {
    const schedule = clockSchedule({ kind: "cron", expr: "0 9 * * 1-5" });
    const at = new Date("2026-10-21T03:30:00.000Z");
    expect(nextOccurrence(schedule, at).toISOString()).toBe("2026-10-22T03:30:00.000Z");
  });

  it("crosses the month boundary in IST", () => {
    const schedule = clockSchedule({ kind: "cron", expr: "0 20 1 * *" });
    const from = new Date("2026-11-01T14:30:00.000Z");
    expect(nextOccurrence(schedule, from).toISOString()).toBe("2026-12-01T14:30:00.000Z");
  });
});

describe("nextOccurrence (once, interval)", () => {
  it("once returns the instant itself, even when in the past", () => {
    const schedule = clockSchedule({ kind: "once", at: "2026-01-01T09:00:00+05:30" });
    expect(nextOccurrence(schedule, FROM).toISOString()).toBe("2026-01-01T03:30:00.000Z");
  });

  it("interval adds minutes to `from` (the chain's anchor carries the phase)", () => {
    const schedule = clockSchedule({ kind: "interval", minutes: 30 });
    expect(nextOccurrence(schedule, FROM).toISOString()).toBe("2026-10-20T10:30:00.000Z");
  });

  it("chains without drift by advancing from the fired occurrence", () => {
    const schedule = clockSchedule({ kind: "interval", minutes: 90 });
    const first = nextOccurrence(schedule, FROM);
    const second = nextOccurrence(schedule, first);
    expect(second.toISOString()).toBe("2026-10-20T13:00:00.000Z");
  });
});

describe("grace", () => {
  it("clamps to 5 minutes at the floor", () => {
    expect(graceMinutes(6)).toBe(5);
    expect(graceMinutes(1)).toBe(5);
  });

  it("returns half the period inside the band", () => {
    expect(graceMinutes(20)).toBe(10);
    expect(graceMinutes(60)).toBe(30);
    expect(graceMinutes(240)).toBe(120);
  });

  it("clamps to 120 minutes at the ceiling", () => {
    expect(graceMinutes(241)).toBe(120);
    expect(graceMinutes(1440)).toBe(120);
  });

  it("accepts an occurrence within grace and rejects one past it", () => {
    const schedule = parseSchedule({ kind: "cron", expr: "0 9 * * 1-5" });
    const slot = new Date("2026-10-21T03:30:00.000Z");
    expect(withinGrace(schedule, slot, new Date(slot.getTime() + 119 * 60_000))).toBe(true);
    expect(withinGrace(schedule, slot, new Date(slot.getTime() + 121 * 60_000))).toBe(false);
  });

  it("once schedules always fire late", () => {
    const schedule = parseSchedule({ kind: "once", at: "2026-01-01T09:00:00+05:30" });
    expect(withinGrace(schedule, new Date("2026-01-01T03:30:00Z"), FROM)).toBe(true);
  });
});

describe("periodMinutes", () => {
  it("derives the period from the first two cron slots", () => {
    expect(periodMinutes(parseSchedule({ kind: "cron", expr: "0 9 * * 1-5" }))).toBe(1440);
    expect(periodMinutes(parseSchedule({ kind: "cron", expr: "*/20 * * * *" }))).toBe(20);
    expect(periodMinutes(parseSchedule({ kind: "interval", minutes: 45 }))).toBe(45);
    expect(
      periodMinutes(parseSchedule({ kind: "once", at: "2026-01-01T09:00:00+05:30" })),
    ).toBeUndefined();
  });
});

describe("describeSchedule", () => {
  it("renders cron as a cronstrue sentence", () => {
    expect(describeSchedule(parseSchedule({ kind: "cron", expr: "0 9 * * 1-5" }))).toBe(
      "At 09:00, Monday through Friday",
    );
  });

  it("renders interval and once in plain words", () => {
    expect(describeSchedule(parseSchedule({ kind: "interval", minutes: 30 }))).toBe(
      "Every 30 minutes",
    );
    expect(describeSchedule(parseSchedule({ kind: "interval", minutes: 60 }))).toBe("Every hour");
    expect(describeSchedule(parseSchedule({ kind: "interval", minutes: 120 }))).toBe(
      "Every 2 hours",
    );
    expect(describeSchedule(parseSchedule({ kind: "once", at: "2026-11-01T09:00:00+05:30" }))).toBe(
      "Once, Sun, 01 Nov 2026, 09:00 IST",
    );
  });
});

describe("formatIst and labels", () => {
  it("renders an IST wall clock with day-crossing awareness", () => {
    expect(formatIst(new Date("2026-10-20T03:30:00.000Z"))).toBe("Tue, 20 Oct 2026, 09:00 IST");
    expect(formatIst(new Date("2026-10-19T19:00:00.000Z"))).toBe("Tue, 20 Oct 2026, 00:30 IST");
  });

  it("composes the prompt header with the occurrence and optional lateness", () => {
    const at = new Date("2026-10-20T03:30:00.000Z");
    expect(composeRoutineLabel("weekday-digest", at)).toBe(
      '**Routine "weekday-digest" (scheduled Tue, 20 Oct 2026, 09:00 IST):**',
    );
    expect(composeRoutineLabel("digest", at, 7)).toBe(
      '**Routine "digest" (scheduled Tue, 20 Oct 2026, 09:00 IST) (late by 7m):**',
    );
    expect(composeRoutinePrompt("digest", "Do the thing.", at)).toBe(
      '**Routine "digest" (scheduled Tue, 20 Oct 2026, 09:00 IST):**\nDo the thing.',
    );
  });
});

describe("schedule validation", () => {
  it("rejects intervals under 15 minutes and over 1440", () => {
    expect(scheduleSchema.safeParse({ kind: "interval", minutes: 14 }).success).toBe(false);
    expect(scheduleSchema.safeParse({ kind: "interval", minutes: 5 }).success).toBe(false);
    expect(scheduleSchema.safeParse({ kind: "interval", minutes: 1441 }).success).toBe(false);
    expect(scheduleSchema.safeParse({ kind: "interval", minutes: 15 }).success).toBe(true);
    expect(scheduleSchema.safeParse({ kind: "interval", minutes: 1440 }).success).toBe(true);
  });

  it("rejects malformed and out-of-range cron", () => {
    expect(scheduleSchema.safeParse({ kind: "cron", expr: "not cron" }).success).toBe(false);
    expect(scheduleSchema.safeParse({ kind: "cron", expr: "99 * * * *" }).success).toBe(false);
    expect(scheduleSchema.safeParse({ kind: "cron", expr: "" }).success).toBe(false);
  });

  it("rejects 6-field (seconds) cron and accepts 5-field", () => {
    expect(scheduleSchema.safeParse({ kind: "cron", expr: "0 30 9 * * *" }).success).toBe(false);
    expect(scheduleSchema.safeParse({ kind: "cron", expr: "30 9 * * *" }).success).toBe(true);
  });

  it("rejects once without an offset and accepts explicit offsets (Z or +05:30)", () => {
    expect(scheduleSchema.safeParse({ kind: "once", at: "2026-11-01T09:00:00" }).success).toBe(
      false,
    );
    expect(scheduleSchema.safeParse({ kind: "once", at: "not a date" }).success).toBe(false);
    expect(scheduleSchema.safeParse({ kind: "once", at: "2026-11-01T09:00:00Z" }).success).toBe(
      true,
    );
    expect(
      scheduleSchema.safeParse({ kind: "once", at: "2026-11-01T09:00:00+05:30" }).success,
    ).toBe(true);
  });

  it("rejects unknown kinds and non-object values", () => {
    expect(scheduleSchema.safeParse({ kind: "webhook", url: "https://x" }).success).toBe(false);
    expect(scheduleSchema.safeParse("0 9 * * *").success).toBe(false);
    expect(scheduleSchema.safeParse(null).success).toBe(false);
  });

  it("exposes the IST constant used everywhere", () => {
    expect(TZ_IST).toBe("Asia/Kolkata");
  });
});
