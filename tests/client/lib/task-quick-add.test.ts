import { describe, expect, it } from "vite-plus/test";
import { parseQuickTask } from "@/lib/task-quick-add";

// Friday 30 Oct 2026, 10:00 local.
const now = new Date(2026, 9, 30, 10, 0);

describe("parseQuickTask", () => {
  it("reads a day, a time and a priority, and keeps the rest as the title", () => {
    const parsed = parseQuickTask("Call mom tomorrow 5pm !high", now);
    expect(parsed.title).toBe("Call mom");
    expect(parsed.priority).toBe("high");
    expect(parsed.due).toEqual(new Date(2026, 9, 31, 17, 0));
  });

  it("reads weekdays as the next such day, and 'at' times", () => {
    // Today is Friday: "fri" means next week's.
    expect(parseQuickTask("Standup fri at 9:30am", now).due).toEqual(new Date(2026, 10, 6, 9, 30));
    expect(parseQuickTask("Gym monday", now).due).toEqual(new Date(2026, 10, 2, 23, 59));
  });

  it("moves a time that already passed today to tomorrow", () => {
    expect(parseQuickTask("Water plants 8am", now).due).toEqual(new Date(2026, 9, 31, 8, 0));
  });

  it("leaves plain titles and bare numbers alone", () => {
    expect(parseQuickTask("Buy 2 milk", now)).toEqual({ title: "Buy 2 milk" });
    expect(parseQuickTask("Read chapter 12 !low", now)).toEqual({
      title: "Read chapter 12",
      priority: "low",
    });
  });

  it("keeps the words when nothing but shorthand was typed", () => {
    expect(parseQuickTask("tomorrow", now)).toEqual({ title: "tomorrow" });
  });
});
