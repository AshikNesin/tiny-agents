import { describe, expect, it } from "vite-plus/test";
import {
  describeSchedule,
  formatIst,
  isValidCron,
  istInputFromAt,
  nextOccurrence,
  onceAtFromIstInput,
  previewFireTimes,
} from "../../../apps/web/src/shared/routines-schedule";

describe("formatIst", () => {
  it("renders an IST wall clock with day-crossing awareness", () => {
    expect(formatIst(new Date("2026-10-20T03:30:00.000Z"))).toBe("Tue, 20 Oct 2026, 09:00 IST");
    expect(formatIst("2026-10-19T19:00:00.000Z")).toBe("Tue, 20 Oct 2026, 00:30 IST");
  });
});

describe("describeSchedule", () => {
  it("matches the server's wording for cron, interval, and once", () => {
    expect(describeSchedule({ kind: "cron", expr: "0 9 * * 1-5" })).toBe(
      "At 09:00, Monday through Friday",
    );
    expect(describeSchedule({ kind: "interval", minutes: 30 })).toBe("Every 30 minutes");
    expect(describeSchedule({ kind: "interval", minutes: 60 })).toBe("Every hour");
    expect(describeSchedule({ kind: "interval", minutes: 120 })).toBe("Every 2 hours");
    expect(describeSchedule({ kind: "once", at: "2026-11-01T03:30:00.000Z" })).toBe(
      "Once, Sun, 01 Nov 2026, 09:00 IST",
    );
  });
});

describe("once inputs (IST wall time)", () => {
  it("appends the +05:30 offset a datetime-local value cannot carry", () => {
    expect(onceAtFromIstInput("2026-11-01T09:00")).toBe("2026-11-01T09:00:00+05:30");
    const instant = new Date(onceAtFromIstInput("2026-11-01T09:00"));
    expect(instant.toISOString()).toBe("2026-11-01T03:30:00.000Z");
  });

  it("round-trips a stored at back into the input value", () => {
    expect(istInputFromAt("2026-11-01T03:30:00.000Z")).toBe("2026-11-01T09:00");
    expect(istInputFromAt(onceAtFromIstInput("2027-02-14T18:45"))).toBe("2027-02-14T18:45");
  });
});

describe("nextOccurrence and previews", () => {
  it("steps cron in IST across the UTC day boundary", () => {
    const next = nextOccurrence(
      { kind: "cron", expr: "0 9 * * *" },
      new Date("2026-10-20T10:00:00Z"),
    );
    expect(next.toISOString()).toBe("2026-10-21T03:30:00.000Z");
  });

  it("steps interval by exact minutes and once stays at its instant", () => {
    const from = new Date("2026-10-19T16:31:07.000Z");
    expect(nextOccurrence({ kind: "interval", minutes: 15 }, from).toISOString()).toBe(
      "2026-10-19T16:46:07.000Z",
    );
    expect(
      nextOccurrence({ kind: "once", at: "2026-11-01T03:30:00.000Z" }, from).toISOString(),
    ).toBe("2026-11-01T03:30:00.000Z");
  });

  it("previews three successive fire times", () => {
    const times = previewFireTimes(
      { kind: "interval", minutes: 15 },
      new Date("2026-10-19T16:31:00Z"),
    );
    expect(times.map((t) => t.toISOString())).toEqual([
      "2026-10-19T16:46:00.000Z",
      "2026-10-19T17:01:00.000Z",
      "2026-10-19T17:16:00.000Z",
    ]);
  });
});

describe("isValidCron", () => {
  it("accepts 5-field expressions and rejects the rest", () => {
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
    expect(isValidCron("*/15 * * * *")).toBe(true);
    expect(isValidCron("0 9 * * *")).toBe(true);
    expect(isValidCron("* * * * * *")).toBe(false);
    expect(isValidCron("0 9 * *")).toBe(false);
    expect(isValidCron("99 9 * * *")).toBe(false);
    expect(isValidCron("")).toBe(false);
  });
});
