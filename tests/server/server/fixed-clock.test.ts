import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { installFixedClock } from "../../../apps/web/src/server/fixed-clock";

let RealDate = globalThis.Date;
beforeEach(() => {
  RealDate = globalThis.Date;
});
afterEach(() => {
  globalThis.Date = RealDate;
});

describe("installFixedClock", () => {
  it("freezes Date only in faux mode", () => {
    expect(
      installFixedClock({ TINY_AGENTS_FIXED_NOW: "2030-01-02T03:04:05.000Z" }),
    ).toBeUndefined();
    expect(globalThis.Date).toBe(RealDate);

    const at = installFixedClock({
      TINY_AGENTS_FAUX: "1",
      TINY_AGENTS_FIXED_NOW: "2030-01-02T03:04:05.000Z",
    });
    expect(at).toBe("2030-01-02T03:04:05.000Z");
    expect(Date.now()).toBe(Date.parse("2030-01-02T03:04:05.000Z"));
    expect(new Date().toISOString()).toBe("2030-01-02T03:04:05.000Z");
    expect(new Date(0).toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(new Date("2031-05-06").getUTCFullYear()).toBe(2031);
    expect(new Date() instanceof RealDate).toBe(true);
  });

  it("refuses an instant it cannot read", () => {
    expect(() =>
      installFixedClock({ TINY_AGENTS_FAUX: "1", TINY_AGENTS_FIXED_NOW: "soon" }),
    ).toThrow(/not a date/);
  });
});
