/**
 * The browser session manager's lifecycle rules, with a fake transport and
 * a fake clock: a close during an open never resurrects the browser, the
 * idle sweep closes only idle browsers, planning never launches, and an
 * action tool waits on the owner's hand-back rather than polling.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  createBrowserSessions,
  type BrowserClock,
  type BrowserSession,
  type BrowserTransport,
} from "../../../../packages/agent/src/toolkits/browser-sessions";

const TARGET = { profile: "p1", tab: "t1" };

/** A controllable clock: timers fire only when the test advances it. */
function fakeClock() {
  let now = 1_000_000;
  const timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  let seq = 0;
  const clock: BrowserClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (handle) => void timers.delete(handle as number),
    setInterval: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn, every: ms });
      return id;
    },
    clearInterval: (handle) => void timers.delete(handle as number),
  };
  return {
    clock,
    pending: () => timers.size,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.at > now) continue;
        if (timer.every) timer.at = now + timer.every;
        else timers.delete(id);
        timer.fn();
      }
    },
  };
}

function fakeTransport(options: { gate?: Promise<void> } = {}) {
  const log: string[] = [];
  let dials = 0;
  const open = async () => {
    dials += 1;
    if (options.gate) await options.gate;
    const session: BrowserSession = {
      url: () => "about:blank",
      navigate: async (url) => ({ url, status: 200 }),
      snapshot: async () => "",
      click: async () => ({ url: "about:blank" }),
      type: async () => ({ url: "about:blank" }),
      press: async () => {},
      scroll: async () => {},
      screenshot: async () => ({ data: "" }),
      close: async () => {
        log.push("close");
      },
    };
    return session;
  };
  const transport: BrowserTransport = Object.assign(open, {
    wipe: async (dir: string) => {
      log.push(`wipe ${dir}`);
    },
  });
  return {
    transport,
    log,
    get dials() {
      return dials;
    },
  };
}

describe("browser sessions", () => {
  it("never launches a browser to peek", async () => {
    const fake = fakeTransport();
    const sessions = createBrowserSessions({
      transport: fake.transport,
      profilesDir: "/tmp/ta-bs",
    });
    expect(sessions.peek(TARGET)).toBeUndefined();
    expect(sessions.get(TARGET)).toBeUndefined();
    expect(fake.dials).toBe(0);
    await sessions.acquire(TARGET);
    expect(sessions.peek(TARGET)?.session).toBeDefined();
    expect(fake.dials).toBe(1);
    await sessions.closeAll();
  });

  it("a close during an open closes (and wipes) the browser once it arrives, never showing it live", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeTransport({ gate });
    const sessions = createBrowserSessions({
      transport: fake.transport,
      profilesDir: "/tmp/ta-bs",
    });

    const opening = sessions.start(TARGET);
    expect(sessions.openState(TARGET)).toEqual({ opening: true, phase: "starting" });
    const closing = sessions.close(TARGET, { wipeProfile: true });
    release();
    await expect(opening).rejects.toThrow("closed while it was opening");
    await closing;

    expect(sessions.get(TARGET)).toBeUndefined();
    expect(fake.log).toEqual(["close", "wipe /tmp/ta-bs/p1"]);
    // Not an open failure the status route should report.
    expect(sessions.openState(TARGET)).toEqual({ opening: false, error: undefined });
    // The next call opens fresh.
    await sessions.acquire(TARGET);
    expect(sessions.get(TARGET)).toBeDefined();
    expect(fake.dials).toBe(2);
    await sessions.closeAll();
  });

  it("wipes a profile no browser has open: its local dir and the transport's copy", async () => {
    const profilesDir = mkdtempSync(join(tmpdir(), "ta-bs-wipe-"));
    const fake = fakeTransport();
    const sessions = createBrowserSessions({ transport: fake.transport, profilesDir });
    await sessions.acquire(TARGET);
    await sessions.close(TARGET);
    const dir = join(profilesDir, TARGET.profile);
    expect(existsSync(dir)).toBe(true);

    await sessions.close(TARGET, { wipeProfile: true });

    expect(existsSync(dir)).toBe(false);
    expect(fake.log).toEqual(["close", `wipe ${dir}`]);
    rmSync(profilesDir, { recursive: true, force: true });
  });

  it("an open that starts during a wiping close waits for the wipe, then opens fresh", async () => {
    const profilesDir = mkdtempSync(join(tmpdir(), "ta-bs-race-"));
    const fake = fakeTransport();
    const sessions = createBrowserSessions({ transport: fake.transport, profilesDir });
    await sessions.acquire(TARGET);
    const dir = join(profilesDir, TARGET.profile);

    const closing = sessions.close(TARGET, { wipeProfile: true });
    const reopened = sessions.acquire(TARGET);
    await Promise.all([closing, reopened]);

    expect(sessions.get(TARGET)).toBeDefined();
    expect(existsSync(dir)).toBe(true);
    expect(fake.log).toEqual(["close", `wipe ${dir}`]);
    await sessions.closeAll();
    rmSync(profilesDir, { recursive: true, force: true });
  });

  it("a failed wipe of the transport's copy fails the close, and a close clears the last open error", async () => {
    const profilesDir = mkdtempSync(join(tmpdir(), "ta-bs-fail-"));
    const failing: BrowserTransport = Object.assign(
      async (): Promise<BrowserSession> => {
        throw new Error("no display");
      },
      {
        wipe: async () => {
          throw new Error("VM unreachable");
        },
      },
    );
    const sessions = createBrowserSessions({ transport: failing, profilesDir });
    await expect(sessions.acquire(TARGET)).rejects.toThrow("no display");
    expect(sessions.openState(TARGET)).toEqual({
      opening: false,
      error: expect.stringMatching(/no display/),
    });

    await expect(sessions.close(TARGET, { wipeProfile: true })).rejects.toThrow("VM unreachable");

    expect(sessions.openState(TARGET)).toEqual({ opening: false });
    rmSync(profilesDir, { recursive: true, force: true });
  });

  it("sweeps idle browsers on the clock, and never one the owner drives", async () => {
    const { clock, advance } = fakeClock();
    const fake = fakeTransport();
    const sessions = createBrowserSessions({
      transport: fake.transport,
      profilesDir: "/tmp/ta-bs",
      idleMinutes: 1,
      clock,
    });
    await sessions.acquire(TARGET);
    await sessions.acquire({ profile: "p2", tab: "t2" });
    await sessions.setDriver({ profile: "p2", tab: "t2" }, "human");

    advance(30_000);
    expect(sessions.profiles().sort()).toEqual(["p1", "p2"]);
    advance(60_000); // past the minute: the sweep runs
    expect(sessions.profiles()).toEqual(["p2"]);
    expect(fake.log).toEqual(["close"]);
    await sessions.closeAll();
  });

  it("an action waits for the owner's hand-back and wakes at once, bounded by the clock", async () => {
    const { clock, advance, pending } = fakeClock();
    const fake = fakeTransport();
    const sessions = createBrowserSessions({
      transport: fake.transport,
      profilesDir: "/tmp/ta-bs",
      humanDriverWaitMs: 5_000,
      clock,
    });
    await sessions.acquire(TARGET);
    await sessions.setDriver(TARGET, "human");

    let done = false;
    const waiting = sessions.actionTurn(TARGET).then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(false);
    const timersWhileWaiting = pending();
    await sessions.setDriver(TARGET, "agent");
    await waiting;
    expect(done).toBe(true);
    // The wait's timer went with the hand-back; no polling timer is left behind.
    expect(pending()).toBe(timersWhileWaiting - 1);

    // Nobody hands back: the bound ends the wait with the takeover message.
    await sessions.setDriver(TARGET, "human");
    const timedOut = sessions.actionTurn(TARGET);
    await new Promise((r) => setTimeout(r, 10));
    advance(5_000);
    await expect(timedOut).rejects.toThrow("owner is driving the browser");
    await sessions.closeAll();
  });

  it("closeAll cancels opens in flight and stops the sweep", async () => {
    const { clock, pending } = fakeClock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeTransport({ gate });
    const sessions = createBrowserSessions({
      transport: fake.transport,
      profilesDir: "/tmp/ta-bs",
      clock,
    });
    const opening = sessions.acquire(TARGET);
    expect(pending()).toBe(1); // the sweep
    const closing = sessions.closeAll();
    release();
    await expect(opening).rejects.toThrow("closed while it was opening");
    await closing;
    expect(sessions.get(TARGET)).toBeUndefined();
    expect(fake.log).toEqual(["close"]);
    expect(pending()).toBe(0);
  });
});
