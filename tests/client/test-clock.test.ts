import { describe, expect, it, vi } from "vite-plus/test";
import { FIXED_NOW, futureIso } from "../test-clock";

describe("test clock", () => {
  it("reports FIXED_NOW as now, and timers still fire", async () => {
    expect(new Date().toISOString()).toBe(FIXED_NOW);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(new Date().toISOString()).toBe(FIXED_NOW);
  });

  it("re-pins now before each test", () => {
    vi.setSystemTime("2030-01-01T00:00:00.000Z");
  });

  it("is back at FIXED_NOW after a test moved it", () => {
    expect(Date.now()).toBe(Date.parse(FIXED_NOW));
    expect(futureIso(25)).toBe("2026-12-01T06:30:00.000Z");
  });
});
