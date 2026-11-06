/**
 * @vitest-environment jsdom
 *
 * The Live view module: what the Browser and Computer panels and pages share.
 * The connection label, the poll cadence, the docked width's clamp, the
 * status a server action leaves behind, and full screen with its keyboard
 * lock. The surfaces' own tests cover how they wire these in.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { toast } from "sonner";
import {
  LOCKED_KEYS,
  MIN_PANEL_WIDTH,
  POLL_MS,
  POLL_STARTING_MS,
  clampPanelWidth,
  connectionOf,
  isStreaming,
  maxPanelWidth,
  pollInterval,
  settle,
  useFullScreen,
} from "@/lib/live-view";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("connectionOf", () => {
  it("reads a closed view before the first status, and while closed", () => {
    expect(connectionOf(null, "connecting").label).toBe("Closed");
    expect(connectionOf({ mode: null }, "live")).toEqual({
      label: "Closed",
      dot: "bg-muted-foreground",
    });
  });

  it("says a computer without a sandbox VM is not set up, before anything else", () => {
    expect(connectionOf({ configured: false, starting: true, mode: null }, "live").label).toBe(
      "Not set up",
    );
  });

  it("pulses while starting", () => {
    expect(connectionOf({ starting: true, mode: null }, "connecting")).toEqual({
      label: "Starting",
      dot: "animate-pulse bg-muted-foreground",
    });
  });

  it("has no connection to show for a headless browser", () => {
    expect(connectionOf({ mode: "headless" }, "live")).toEqual({
      label: "Headless",
      dot: "bg-muted-foreground",
    });
  });

  it("follows the viewer while streaming", () => {
    expect(connectionOf({ mode: "vnc" }, "live")).toEqual({ label: "Live", dot: "bg-success" });
    expect(connectionOf({ mode: "vnc" }, "connecting")).toEqual({
      label: "Connecting",
      dot: "animate-pulse bg-warning",
    });
    expect(connectionOf({ mode: "vnc" }, "reconnecting").label).toBe("Reconnecting");
  });
});

describe("pollInterval", () => {
  it("polls every 1.5s while something starts, else every 3s", () => {
    expect(pollInterval(true)).toBe(POLL_STARTING_MS);
    expect(pollInterval(false)).toBe(POLL_MS);
    expect([POLL_STARTING_MS, POLL_MS]).toEqual([1500, 3000]);
  });
});

describe("panel width", () => {
  it("never lets a dragged panel crowd out the chat (issue #89)", () => {
    // 1280 - 256px sidebar - 416px chat leaves at most 608px for the panel.
    expect(maxPanelWidth(1280)).toBe(608);
    expect(clampPanelWidth(5000, 1280)).toBe(608);
  });

  it("keeps a wide screen's panel to three quarters of it", () => {
    expect(maxPanelWidth(3000)).toBe(2250);
  });

  it("never goes below the minimum, even on a narrow screen", () => {
    expect(clampPanelWidth(100, 1600)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(900, 800)).toBe(MIN_PANEL_WIDTH);
  });

  it("rounds to whole pixels", () => {
    expect(clampPanelWidth(640.6, 1600)).toBe(641);
  });
});

describe("settle", () => {
  const browser = { active: true, driver: "agent" as const, mode: "vnc" as const };
  const desktop = { active: true, driver: "human" as const, takeover: "Sign in, please" };

  it("switches the driver", () => {
    expect(settle("browser", browser, { driver: "human" })).toEqual({
      ...browser,
      driver: "human",
    });
  });

  it("answers a desktop's takeover request on release", () => {
    expect(settle("computer", desktop, { driver: "agent" })).toEqual({
      ...desktop,
      driver: "agent",
      takeover: null,
    });
    expect(settle("computer", desktop, { driver: "human" }).takeover).toBe("Sign in, please");
  });

  it("shows an open as starting and clears the last failure", () => {
    expect(
      settle("browser", { ...browser, active: false, error: "boom" }, "started"),
    ).toMatchObject({ starting: true, error: null });
  });

  it("closes the browser or desktop on reset", () => {
    expect(settle("browser", browser, "reset")).toEqual({
      active: false,
      driver: null,
      mode: null,
    });
    expect(settle("computer", desktop, "reset")).toEqual({
      active: false,
      driver: null,
      takeover: null,
    });
  });
});

describe("isStreaming", () => {
  it("streams a live desktop, and a live browser only with a display", () => {
    expect(isStreaming("computer", { active: true, driver: null })).toBe(true);
    expect(isStreaming("browser", { active: true, driver: null, mode: "vnc" })).toBe(true);
    expect(isStreaming("browser", { active: true, driver: null, mode: "headless" })).toBe(false);
    expect(isStreaming("computer", { active: false, driver: null })).toBe(false);
    expect(isStreaming("browser", undefined)).toBe(false);
  });
});

describe("LOCKED_KEYS", () => {
  it("keeps the browser's shortcuts for the remote browser in full screen", () => {
    expect(LOCKED_KEYS.browser).toEqual([
      "Escape",
      "Tab",
      "KeyW",
      "KeyT",
      "KeyN",
      "KeyL",
      "KeyR",
      "F5",
    ]);
  });

  it("also gives the desktop its app shortcuts (Ctrl+Q, Alt+F4)", () => {
    expect(LOCKED_KEYS.computer).toEqual(expect.arrayContaining([...LOCKED_KEYS.browser]));
    expect(LOCKED_KEYS.computer).toEqual(expect.arrayContaining(["KeyQ", "F4"]));
  });
});

describe("useFullScreen", () => {
  afterEach(() => {
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    Reflect.deleteProperty(navigator, "keyboard");
    vi.mocked(toast.error).mockClear();
  });

  function setup(options?: { fallback?: "css" }) {
    const element = document.createElement("div");
    const ref = { current: element };
    const keys = ["Escape", "KeyW"];
    const hook = renderHook(() => useFullScreen(ref, keys, options));
    return { element, hook };
  }

  const change = (element: Element | null) =>
    act(() => {
      Object.defineProperty(document, "fullscreenElement", { value: element, configurable: true });
      document.dispatchEvent(new Event("fullscreenchange"));
    });

  it("locks the keys while its element is full screen, and unlocks after", () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const unlock = vi.fn();
    Object.defineProperty(navigator, "keyboard", { value: { lock, unlock }, configurable: true });
    const { element, hook } = setup();

    change(element);
    expect(hook.result.current.fullscreen).toBe(true);
    expect(lock).toHaveBeenCalledWith(["Escape", "KeyW"]);

    change(null);
    expect(hook.result.current.fullscreen).toBe(false);
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("ignores another element going full screen", () => {
    const { hook } = setup();
    change(document.createElement("div"));
    expect(hook.result.current.fullscreen).toBe(false);
  });

  it("says so where the Fullscreen API is missing", () => {
    const { hook } = setup();
    act(() => hook.result.current.toggleFullscreen());
    expect(toast.error).toHaveBeenCalledWith("Full screen is not available in this browser.");
    expect(hook.result.current.fullscreen).toBe(false);
  });

  it("falls back to the caller's CSS full screen when asked to", () => {
    const { hook } = setup({ fallback: "css" });
    act(() => hook.result.current.toggleFullscreen());
    expect(hook.result.current.fullscreen).toBe(true);
    act(() => hook.result.current.toggleFullscreen());
    expect(hook.result.current.fullscreen).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
