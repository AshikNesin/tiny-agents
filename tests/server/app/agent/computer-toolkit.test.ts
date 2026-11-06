/**
 * The computer toolkit (issue #108) against a fake desktop: the port
 * contract, the driver flag (reads refused and actions waiting while the
 * owner drives), the takeover request, relaunching a dead desktop, the
 * never-echo-typed-text rule and the key rules.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import {
  createComputerSessions,
  createComputerToolkit,
  normalizeKeys,
  windowTarget,
  type ComputerSessions,
} from "../../../../packages/agent/src/toolkits/computer";
import { takeoverOf } from "../../../../packages/agent/src/toolkits/computer-sessions";
import { WaitTracker } from "../../../../packages/agent/src/waiting";
import { FAKE_JPEG, fakeComputer, type FakeComputer } from "./computer-fakes";

const sessionsList: ComputerSessions[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.allSettled(sessionsList.splice(0).map((s) => s.closeAll()));
});

function setup(options: { humanDriverWaitMs?: number; ownerWaits?: WaitTracker } = {}) {
  const fake = fakeComputer();
  const sessions = createComputerSessions({
    transport: fake.transport,
    width: 1280,
    height: 800,
    humanDriverWaitMs: options.humanDriverWaitMs,
  });
  sessionsList.push(sessions);
  const toolkit = createComputerToolkit({
    sessions,
    settleMs: 0,
    takeoverWaitMs: 2_000,
    ownerWaits: options.ownerWaits,
    resolveProfile: (id) => (id === 7 ? "bot-7" : "shared"),
  });
  return { fake, sessions, toolkit };
}

async function run(
  capability: Capability,
  name: string,
  args: Record<string, unknown> = {},
  conversationId = "4242",
  details: unknown[] = [],
) {
  const tool = capability.extension.tools!.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const api = {
    conversationId,
    taskId: "1",
    memo: async (_key: string, value: unknown) => value,
    snapshot: async () => null,
    details: async (value: unknown) => void details.push(value),
  } as unknown as ToolExecutionApi;
  const result = (await tool.execute(
    args as never,
    api,
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  const images = (result.output ?? []).filter((b) => b.type === "image");
  return { ...result, text, images };
}

const methods = (fake: FakeComputer) => fake.log.map((entry) => entry.method);

describe("computer toolkit", () => {
  it("offers no tools without a desktop, but lists them with the setup hint", () => {
    const toolkit = createComputerToolkit({ setupHint: "Set SANDBOX_HOST to use the computer." });
    expect(toolkit.extension.tools).toEqual([]);
    expect(toolkit.tools.map((t) => t.name)).toContain("computer_click");
    expect(toolkit.setupHint).toMatch(/SANDBOX_HOST/);
  });

  it("marks reads allow, effects ask, and closing a window or reading the clipboard ask-only", () => {
    const { toolkit } = setup();
    const info = Object.fromEntries(toolkit.tools.map((t) => [t.name, t]));
    for (const name of [
      "computer_screenshot",
      "computer_zoom",
      "computer_cursor_position",
      "computer_list_windows",
      "computer_list_apps",
      "computer_wait",
      "computer_request_takeover",
    ]) {
      expect(info[name].readOnly, name).toBe(true);
    }
    for (const name of [
      "computer_click",
      "computer_type",
      "computer_key",
      "computer_open_app",
      "computer_drag",
      "computer_scroll",
      "computer_move",
      "computer_clipboard_set",
    ]) {
      expect(info[name].readOnly, name).toBeFalsy();
    }
    expect(info.computer_close_window.askOnly).toBe(true);
    expect(info.computer_clipboard_get.askOnly).toBe(true);
    // Every tool the model sees has catalog metadata, and vice versa.
    expect(toolkit.extension.tools!.map((t) => t.name).sort()).toEqual(
      toolkit.tools.map((t) => t.name).sort(),
    );
    // Effects interrupt instead of re-running after a crash.
    for (const tool of toolkit.extension.tools!) {
      if (!info[tool.name].readOnly && !info[tool.name].askOnly) {
        expect(tool.replay, tool.name).toBe("unsafe");
      }
    }
  });

  it("opens the desktop lazily and answers a screenshot with an image", async () => {
    const { fake, toolkit } = setup();
    expect(fake.opened).toEqual([]);
    const result = await run(toolkit, "computer_screenshot");
    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("1280x800");
    expect(result.images).toEqual([
      { type: "image", data: FAKE_JPEG.toString("base64"), mimeType: "image/jpeg" },
    ]);
    expect(result.details).toEqual({ screenshot: true });
    expect(fake.opened).toEqual(["shared"]);
  });

  it("uses the profile the app resolves for the conversation", async () => {
    const { fake, toolkit } = setup();
    await run(toolkit, "computer_screenshot", {}, "7");
    await run(toolkit, "computer_screenshot", {}, "8");
    expect(fake.opened).toEqual(["bot-7", "shared"]);
  });

  it("clicks at the given pixel and returns a fresh screenshot", async () => {
    const { fake, toolkit } = setup();
    const result = await run(toolkit, "computer_click", {
      x: 100,
      y: 200,
      count: 2,
      modifiers: ["ctrl", "ctrl"],
    });
    expect(result.text).toBe("Double-clicked at (100, 200).");
    expect(result.images).toHaveLength(1);
    expect(fake.log.find((e) => e.method === "click")?.args).toEqual({
      x: 100,
      y: 200,
      button: "left",
      count: 2,
      modifiers: ["ctrl"],
    });
    expect(methods(fake)).toEqual(["click", "screenshot"]);
  });

  it("refuses a point off the desktop without acting", async () => {
    const { fake, toolkit } = setup();
    const result = await run(toolkit, "computer_click", { x: 1280, y: 10 });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/off the 1280x800 desktop/);
    expect(fake.log).toEqual([]);
  });

  it("never echoes typed or clipboard text in its result", async () => {
    const { fake, toolkit } = setup();
    const secret = "hunter2-typed-text";
    const typed = await run(toolkit, "computer_type", { text: secret });
    expect(typed.text).toBe(`Typed ${secret.length} characters.`);
    expect(JSON.stringify(typed)).not.toContain(secret);
    const clip = await run(toolkit, "computer_clipboard_set", { text: secret });
    expect(clip.text).not.toContain(secret);
    expect(fake.log.find((e) => e.method === "type")?.args).toEqual({ text: secret });
  });

  it("normalizes keys and refuses names xdotool would not know", async () => {
    const { fake, toolkit } = setup();
    const pressed = await run(toolkit, "computer_key", { keys: "Ctrl+S enter", repeat: 2 });
    expect(pressed.isError).toBeFalsy();
    expect(fake.log.find((e) => e.method === "key")?.args).toEqual({
      chords: ["ctrl+S", "Return"],
      repeat: 2,
    });
    const bad = await run(toolkit, "computer_key", { keys: "ctrl+$(reboot)" });
    expect(bad.isError).toBe(true);
    expect(fake.log.filter((e) => e.method === "key")).toHaveLength(1);
  });

  it("flags chords that close windows or quit apps", () => {
    expect(normalizeKeys("alt+F4").closing).toBe(true);
    expect(normalizeKeys("ctrl+q").closing).toBe(true);
    expect(normalizeKeys("Control+W").closing).toBe(true);
    expect(normalizeKeys("shift+ctrl+q").closing).toBe(true);
    expect(normalizeKeys("ctrl+s Return").closing).toBe(false);
    expect(normalizeKeys("Down Down alt+f4").closing).toBe(true);
    expect(normalizeKeys("cmd+space").chords).toEqual(["super+space"]);
    expect(normalizeKeys("ctrl").chords).toEqual(["ctrl"]);
    expect(() => normalizeKeys("hyper+a")).toThrow(/modifier/);
    expect(() => normalizeKeys("")).toThrow();
  });

  it("lists windows with their ids and marks the active one", async () => {
    const { toolkit } = setup();
    const result = await run(toolkit, "computer_list_windows");
    expect(result.text).toContain("0x02200003 (active) mousepad.Mousepad — Untitled 1");
    expect(result.text).toContain("0x02400004 Thunar.Thunar — Home");
  });

  it("refuses screenshots while the owner drives, so nothing they type is seen", async () => {
    const { fake, sessions, toolkit } = setup();
    await run(toolkit, "computer_screenshot");
    await sessions.setDriver("shared", "human");
    for (const name of ["computer_screenshot", "computer_zoom", "computer_clipboard_get"]) {
      const args = name === "computer_zoom" ? { x: 0, y: 0, width: 100, height: 100 } : {};
      const result = await run(toolkit, name, args);
      expect(result.isError, name).toBe(true);
      expect(result.text, name).toMatch(/owner is driving/);
      expect(result.images, name).toEqual([]);
    }
    expect(methods(fake)).toEqual(["screenshot"]);
  });

  it("waits for the owner to hand back before acting, then acts", async () => {
    const { fake, sessions, toolkit } = setup();
    await run(toolkit, "computer_screenshot");
    await sessions.setDriver("shared", "human");
    const pending = run(toolkit, "computer_click", { x: 5, y: 5 });
    await new Promise((r) => setTimeout(r, 30));
    expect(methods(fake)).toEqual(["screenshot"]);
    await sessions.setDriver("shared", "agent");
    const result = await pending;
    expect(result.isError).toBeFalsy();
    expect(methods(fake)).toEqual(["screenshot", "click", "screenshot"]);
  });

  it("gives up on an action after the bounded wait, without acting", async () => {
    vi.useFakeTimers(); // the wait polls Date.now() between timers, so both need to move together
    const { fake, sessions, toolkit } = setup({ humanDriverWaitMs: 30 });
    await run(toolkit, "computer_screenshot");
    await sessions.setDriver("shared", "human");
    const pending = run(toolkit, "computer_type", { text: "hello" });
    await vi.advanceTimersByTimeAsync(30);
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/owner is driving/);
    expect(methods(fake)).toEqual(["screenshot"]);
  });

  it("asks the owner to take over, waits, and returns what they left", async () => {
    const ownerWaits = new WaitTracker();
    const { sessions, toolkit } = setup({ ownerWaits });
    const details: unknown[] = [];
    const pending = run(
      toolkit,
      "computer_request_takeover",
      { reason: "Sign in to  the mail app" },
      "4242",
      details,
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(takeoverOf(details[0])).toEqual({
      status: "pending",
      reason: "Sign in to the mail app",
    });
    expect(sessions.get("shared")?.driver).toBe("human");
    expect(sessions.get("shared")?.takeover?.reason).toBe("Sign in to the mail app");
    expect(ownerWaits.count(4242)).toBe(1);
    // While it waits, the bot sees nothing.
    expect((await run(toolkit, "computer_screenshot")).isError).toBe(true);

    await sessions.setDriver("shared", "agent");
    const result = await pending;
    expect(result.isError).toBeFalsy();
    expect(result.text).toMatch(/handed the computer back/);
    expect(result.images).toHaveLength(1);
    expect(takeoverOf(result.details)?.status).toBe("released");
    expect(sessions.get("shared")?.takeover).toBeUndefined();
    expect(ownerWaits.count(4242)).toBe(0);
  });

  it("reports a takeover nobody answered without handing control back", async () => {
    const { sessions, toolkit } = setup();
    const tool = createComputerToolkit({
      sessions,
      settleMs: 0,
      takeoverWaitMs: 20,
    });
    const result = await run(tool, "computer_request_takeover", { reason: "Pay the invoice" });
    expect(result.isError).toBe(true);
    expect(takeoverOf(result.details)?.status).toBe("expired");
    void toolkit;
  });

  it("relaunches a dead desktop for a read, but never repeats an action on a new one", async () => {
    const { fake, toolkit } = setup();
    await run(toolkit, "computer_screenshot");
    fake.killNext("shared");
    const shot = await run(toolkit, "computer_screenshot");
    expect(shot.isError).toBeFalsy();
    expect(fake.opened).toEqual(["shared", "shared"]);

    fake.killNext("shared");
    const click = await run(toolkit, "computer_click", { x: 1, y: 1 });
    expect(click.isError).toBe(true);
    expect(click.text).toMatch(/desktop stopped/);
    expect(fake.log.filter((e) => e.method === "click")).toHaveLength(1);
    // The next call starts a fresh desktop.
    await run(toolkit, "computer_screenshot");
    expect(fake.opened).toEqual(["shared", "shared", "shared"]);
  });

  it("zooms into a region clipped to the desktop", async () => {
    const { fake, toolkit } = setup();
    const result = await run(toolkit, "computer_zoom", {
      x: 1200,
      y: 700,
      width: 400,
      height: 400,
    });
    expect(result.isError).toBeFalsy();
    expect(fake.log.find((e) => e.method === "screenshot")?.args).toEqual({
      x: 1200,
      y: 700,
      width: 80,
      height: 100,
    });
  });

  it("binds vault targets to a window by class and title", () => {
    expect(windowTarget("firefox", "  Sign in ")).toBe("firefox — “Sign in”");
    expect(windowTarget("mousepad")).toBe("mousepad");
  });
});

describe("computer sessions", () => {
  it("shares one launch between concurrent callers and reports the starting phase", async () => {
    const fake = fakeComputer();
    const sessions = createComputerSessions({ transport: fake.transport });
    sessionsList.push(sessions);
    const release = fake.holdOpens();
    const a = sessions.acquire("shared");
    const b = sessions.acquire("shared");
    expect(sessions.openState("shared")).toEqual({ opening: true, phase: "starting" });
    release();
    expect(await a).toBe(await b);
    expect(fake.opened).toEqual(["shared"]);
  });

  it("reports an open failure until the next attempt", async () => {
    const fake = fakeComputer();
    const sessions = createComputerSessions({ transport: fake.transport });
    sessionsList.push(sessions);
    fake.failNextOpen("No free X display on the VM");
    await expect(sessions.start("shared")).rejects.toThrow(/No free X display/);
    expect(sessions.openState("shared")).toEqual({
      opening: false,
      error: "No free X display on the VM",
    });
    await sessions.start("shared");
    expect(sessions.openState("shared")).toEqual({ opening: false });
  });

  it("closes and wipes a profile, waking anything waiting on the owner", async () => {
    const fake = fakeComputer();
    const sessions = createComputerSessions({ transport: fake.transport });
    sessionsList.push(sessions);
    await sessions.acquire("shared");
    const takeover = sessions.requestTakeover("shared", "Sign in", 60_000);
    await sessions.close("shared", { wipe: true });
    expect(await takeover).toBe("released");
    expect(sessions.get("shared")).toBeUndefined();
    expect(fake.wiped).toEqual(["shared"]);
    expect(fake.log.map((e) => e.method)).toEqual(["close"]);
  });

  it("closes idle desktops on the sweep, but not one the owner drives", async () => {
    let now = 0;
    const intervals: (() => void)[] = [];
    const fake = fakeComputer();
    const sessions = createComputerSessions({
      transport: fake.transport,
      idleMinutes: 1,
      clock: {
        now: () => now,
        setTimeout: () => 0,
        clearTimeout: () => undefined,
        setInterval: (fn) => {
          intervals.push(fn);
          return 0;
        },
        clearInterval: () => undefined,
      },
    });
    sessionsList.push(sessions);
    await sessions.acquire("a");
    await sessions.acquire("b");
    await sessions.setDriver("b", "human");
    now = 5 * 60_000;
    for (const tick of intervals) tick();
    expect(sessions.profiles()).toEqual(["b"]);
  });

  it("rejects profile names that could leave the profiles directory", async () => {
    const fake = fakeComputer();
    const sessions = createComputerSessions({ transport: fake.transport });
    sessionsList.push(sessions);
    await expect(sessions.acquire("../etc")).rejects.toThrow(/Invalid computer profile/);
    expect(fake.opened).toEqual([]);
  });
});
