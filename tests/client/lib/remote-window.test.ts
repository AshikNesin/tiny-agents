/**
 * The remote Chrome window cannot be narrower than 500 CSS pixels, so a narrow
 * viewer asks for a wider window of its own shape and scales it down.
 */
import { describe, expect, it } from "vite-plus/test";
import { MIN_REMOTE_WIDTH, remoteWindowSize } from "@/lib/remote-window";

describe("remoteWindowSize", () => {
  it("gives a viewer that is wide enough exactly its own size", () => {
    expect(remoteWindowSize(632, 827.5)).toEqual({ width: 632, height: 827.5 });
    expect(remoteWindowSize(MIN_REMOTE_WIDTH, 700)).toEqual({ width: 500, height: 700 });
  });

  it("widens a narrower viewer to the minimum, keeping its shape", () => {
    expect(remoteWindowSize(250, 400)).toEqual({ width: 500, height: 800 });

    const size = remoteWindowSize(352, 828);
    expect(size.width).toBe(500);
    expect(size.width / size.height).toBeCloseTo(352 / 828, 10);
  });

  it("leaves a box that has no size yet alone", () => {
    expect(remoteWindowSize(0, 0)).toEqual({ width: 0, height: 0 });
    expect(remoteWindowSize(300, 0)).toEqual({ width: 300, height: 0 });
  });
});
