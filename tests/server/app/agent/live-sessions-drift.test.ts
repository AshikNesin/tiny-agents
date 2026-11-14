/**
 * Where the browser and computer session managers differ (the drift kept by
 * `LiveSessions` options, docs/rewrite/README.md §4.2). Each test pins one
 * difference that no other suite pinned, recorded on the two separate
 * managers before they became instances of one generic. The last block pins
 * microtask order too (where the driver is checked, when each call settles):
 * the rewrite keeps today's behavior, races included.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  createBrowserSessions,
  type BrowserClock,
  type BrowserSession,
  type BrowserTransport,
} from "../../../../packages/sandbox/src/browser-sessions";
import {
  createComputerSessions,
  OwnerDrivingError,
  type ComputerDesktop,
  type ComputerTransport,
} from "../../../../packages/sandbox/src/computer-sessions";
import { fakeComputer } from "./computer-fakes";

const TARGET = { profile: "p1", tab: "t1" };
const PROFILES = "/tmp/ta-live-drift";

/** A clock moved by hand; `sweep` runs the idle sweep (the only interval). */
function manualClock() {
  let now = 0;
  let seq = 0;
  const timeouts = new Map<number, { at: number; fn: () => void }>();
  const intervals: (() => void)[] = [];
  const clock: BrowserClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timeouts.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (handle) => void timeouts.delete(handle as number),
    setInterval: (fn) => {
      intervals.push(fn);
      return 0;
    },
    clearInterval: () => undefined,
  };
  return {
    clock,
    set(ms: number) {
      now = ms;
      for (const [id, timeout] of timeouts) {
        if (timeout.at > now) continue;
        timeouts.delete(id);
        timeout.fn();
      }
    },
    sweep: () => intervals.forEach((tick) => tick()),
  };
}

function browserSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  return {
    url: () => "about:blank",
    navigate: async (url) => ({ url, status: 200 }),
    snapshot: async () => "",
    click: async () => ({ url: "about:blank" }),
    type: async () => ({ url: "about:blank" }),
    press: async () => {},
    scroll: async () => {},
    screenshot: async () => ({ data: "" }),
    close: async () => {},
    ...overrides,
  };
}

function browserTransport(
  open: () => Promise<BrowserSession>,
  log: string[] = [],
): BrowserTransport {
  return Object.assign(open, { wipe: async (dir: string) => void log.push(`wipe ${dir}`) });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("live sessions drift: opening", () => {
  it("computer: an open during a close does not wait for it (the browser's does)", async () => {
    const order: string[] = [];
    let finishClose!: () => void;
    const closeGate = new Promise<void>((resolve) => (finishClose = resolve));
    let opens = 0;
    const transport: ComputerTransport = {
      async open() {
        opens += 1;
        order.push(`open ${opens}`);
        const first = opens === 1;
        return {
          ...fakeDesktop(),
          async close() {
            if (!first) return;
            order.push("close");
            await closeGate;
            order.push("closed");
          },
        };
      },
      async wipe() {
        order.push("wipe");
      },
    };
    const sessions = createComputerSessions({ transport });
    await sessions.acquire("shared");
    const closing = sessions.close("shared", { wipe: true });
    await sessions.acquire("shared");
    expect(order).toEqual(["open 1", "close", "open 2"]);
    finishClose();
    await closing;
    // The wipe lands after the fresh desktop launched.
    expect(order).toEqual(["open 1", "close", "open 2", "closed", "wipe"]);
    expect(sessions.profiles()).toEqual(["shared"]);
    await sessions.closeAll();
  });

  it("computer: a close with wipe during an open wipes on arrival and again after", async () => {
    const fake = fakeComputer();
    const sessions = createComputerSessions({ transport: fake.transport });
    const release = fake.holdOpens();
    const opening = sessions.start("shared");
    expect(sessions.get("shared")).toBeUndefined();
    const closing = sessions.close("shared", { wipe: true });
    release();
    await expect(opening).rejects.toThrow(/^The computer was closed while it was starting\.$/);
    await closing;
    expect(fake.wiped).toEqual(["shared", "shared"]);
    expect(fake.log.map((entry) => entry.method)).toEqual(["close"]);
    expect(sessions.openState("shared")).toEqual({ opening: false, error: undefined });
    await sessions.closeAll();
  });

  it("browser: peek and get show nothing while a browser opens", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const sessions = createBrowserSessions({
      profilesDir: PROFILES,
      transport: browserTransport(async () => {
        await gate;
        return browserSession();
      }),
    });
    const opening = sessions.acquire(TARGET);
    await tick();
    expect(sessions.openState(TARGET)).toEqual({ opening: true, phase: "starting" });
    expect(sessions.peek(TARGET)).toBeUndefined();
    expect(sessions.get(TARGET)).toBeUndefined();
    finish();
    await opening;
    expect(sessions.peek(TARGET)).toBeDefined();
    await sessions.closeAll();
  });

  it("browser: an invalid profile is reported as the last open error; the computer's is not", async () => {
    const browsers = createBrowserSessions({
      profilesDir: PROFILES,
      transport: browserTransport(async () => browserSession()),
    });
    const bad = { profile: "../x", tab: "t" };
    await expect(browsers.acquire(bad)).rejects.toThrow('Invalid browser profile "../x".');
    expect(browsers.openState(bad)).toEqual({
      opening: false,
      error: 'Invalid browser profile "../x".',
    });
    await browsers.closeAll();

    const fake = fakeComputer();
    const computers = createComputerSessions({ transport: fake.transport });
    await expect(computers.acquire("../x")).rejects.toThrow('Invalid computer profile "../x".');
    expect(computers.openState("../x")).toEqual({ opening: false, error: undefined });
    await computers.closeAll();
  });

  it("browser: a failed open is described for the owner; the computer keeps the raw message", async () => {
    const browsers = createBrowserSessions({
      profilesDir: PROFILES,
      transport: browserTransport(async () => {
        throw new Error("Executable doesn't exist at /ms-playwright/chromium");
      }),
    });
    await expect(browsers.acquire(TARGET)).rejects.toThrow("Executable doesn't exist");
    const state = browsers.openState(TARGET);
    expect(state.opening === false && state.error).toMatch(/^No browser is installed/);
    await browsers.closeAll();

    const fake = fakeComputer();
    const computers = createComputerSessions({ transport: fake.transport });
    fake.failNextOpen("Executable doesn't exist at /usr/bin/xfce4-session");
    await expect(computers.acquire("shared")).rejects.toThrow("Executable doesn't exist");
    expect(computers.openState("shared")).toEqual({
      opening: false,
      error: "Executable doesn't exist at /usr/bin/xfce4-session",
    });
    await computers.closeAll();
  });
});

describe("live sessions drift: closing", () => {
  it("browser: a failing close of the browser fails the close and skips the wipe", async () => {
    const log: string[] = [];
    const sessions = createBrowserSessions({
      profilesDir: PROFILES,
      transport: browserTransport(
        async () =>
          browserSession({
            close: async () => {
              throw new Error("chrome hung");
            },
          }),
        log,
      ),
    });
    await sessions.acquire(TARGET);
    await expect(sessions.close(TARGET, { wipeProfile: true })).rejects.toThrow("chrome hung");
    expect(sessions.get(TARGET)).toBeUndefined();
    expect(log).toEqual([]);
    await sessions.closeAll();
  });

  it("browser: closeAll survives a close() that throws synchronously and still closes the rest", async () => {
    const closed: string[] = [];
    let opened = 0;
    const sessions = createBrowserSessions({
      profilesDir: PROFILES,
      transport: browserTransport(async () => {
        const n = ++opened;
        return browserSession({
          close: (() => {
            if (n === 1) throw new Error("sync");
            closed.push(`b${n}`);
            return Promise.resolve();
          }) as BrowserSession["close"],
        });
      }),
    });
    await sessions.acquire({ profile: "p1", tab: "t1" });
    await sessions.acquire({ profile: "p2", tab: "t1" });
    await expect(sessions.closeAll()).resolves.toBeUndefined();
    expect(closed).toEqual(["b2"]);
  });

  it("computer: a failing close of the desktop is swallowed and the wipe still runs", async () => {
    const wiped: string[] = [];
    const transport: ComputerTransport = {
      async open() {
        return {
          ...fakeDesktop(),
          async close() {
            throw new Error("X server hung");
          },
        };
      },
      async wipe(profile) {
        wiped.push(profile);
      },
    };
    const sessions = createComputerSessions({ transport });
    await sessions.acquire("shared");
    await sessions.close("shared", { wipe: true });
    expect(sessions.get("shared")).toBeUndefined();
    expect(wiped).toEqual(["shared"]);
    await sessions.closeAll();
  });
});

describe("live sessions drift: the driver", () => {
  it("browser: a hand-back keeps the takeover's start as the last activity; the computer's restarts the idle window", async () => {
    const browserTime = manualClock();
    const browsers = createBrowserSessions({
      profilesDir: PROFILES,
      transport: browserTransport(async () => browserSession()),
      idleMinutes: 1,
      clock: browserTime.clock,
    });
    await browsers.acquire(TARGET);
    await browsers.setDriver(TARGET, "human");
    browserTime.set(5 * 60_000);
    browserTime.sweep();
    expect(browsers.profiles()).toEqual(["p1"]);
    await browsers.setDriver(TARGET, "agent");
    browserTime.set(5 * 60_000 + 1);
    browserTime.sweep();
    expect(browsers.profiles()).toEqual([]);
    await browsers.closeAll();

    const computerTime = manualClock();
    const fake = fakeComputer();
    const computers = createComputerSessions({
      transport: fake.transport,
      idleMinutes: 1,
      clock: computerTime.clock,
    });
    await computers.acquire("shared");
    await computers.setDriver("shared", "human");
    computerTime.set(5 * 60_000);
    computerTime.sweep();
    await computers.setDriver("shared", "agent");
    computerTime.set(5 * 60_000 + 1);
    computerTime.sweep();
    expect(computers.profiles()).toEqual(["shared"]);
    // Setting the driver it already has counts as activity too.
    computerTime.set(5 * 60_000 + 50_000);
    await computers.setDriver("shared", "agent");
    computerTime.set(5 * 60_000 + 100_000);
    computerTime.sweep();
    expect(computers.profiles()).toEqual(["shared"]);
    await computers.closeAll();
  });

  it("browser: a sweep while a second agent's tab opens closes the browser on its old activity", async () => {
    const time = manualClock();
    let finishTab!: () => void;
    const tabGate = new Promise<void>((resolve) => (finishTab = resolve));
    let closes = 0;
    const sessions = createBrowserSessions({
      profilesDir: PROFILES,
      idleMinutes: 1,
      clock: time.clock,
      transport: browserTransport(async () =>
        browserSession({
          openTab: async () => {
            await tabGate;
            return browserSession();
          },
          close: async () => void (closes += 1),
        }),
      ),
    });
    await sessions.acquire(TARGET);
    time.set(5 * 60_000);
    const second = sessions.acquire({ profile: "p1", tab: "t2" });
    await tick();
    time.sweep();
    expect(sessions.profiles()).toEqual([]);
    expect(closes).toBe(1);
    finishTab();
    await second;
    await sessions.closeAll();
  });

  it("computer: an open of a live desktop counts as activity at once", async () => {
    const time = manualClock();
    const fake = fakeComputer();
    const sessions = createComputerSessions({
      transport: fake.transport,
      idleMinutes: 1,
      clock: time.clock,
    });
    await sessions.acquire("shared");
    time.set(5 * 60_000);
    const again = sessions.acquire("shared");
    time.sweep();
    await again;
    expect(sessions.profiles()).toEqual(["shared"]);
    expect(sessions.get("shared")?.lastActivity).toBe(5 * 60_000);
    await sessions.closeAll();
  });

  it("errors while the owner drives: the computer throws OwnerDrivingError, the browser a plain Error", async () => {
    const time = manualClock();
    const fake = fakeComputer();
    const computers = createComputerSessions({
      transport: fake.transport,
      humanDriverWaitMs: 1_000,
      clock: time.clock,
    });
    await computers.acquire("shared");
    await computers.setDriver("shared", "human");
    const read = computers.readTurn("shared");
    await expect(read).rejects.toBeInstanceOf(OwnerDrivingError);
    await expect(read).rejects.toThrow(
      /^The owner is driving the computer, so screenshots are paused\. Wait for them to hand it back, or continue without the computer\.$/,
    );
    const act = computers.actionTurn("shared");
    await tick();
    time.set(1_000);
    await expect(act).rejects.toBeInstanceOf(OwnerDrivingError);
    await expect(act).rejects.toThrow(
      /^The owner is driving the computer; nothing was done\. Wait and retry, or continue without the computer\.$/,
    );
    await computers.closeAll();

    const browserTime = manualClock();
    const browsers = createBrowserSessions({
      profilesDir: PROFILES,
      transport: browserTransport(async () => browserSession()),
      humanDriverWaitMs: 1_000,
      clock: browserTime.clock,
    });
    await browsers.acquire(TARGET);
    await browsers.setDriver(TARGET, "human");
    await expect(browsers.readTurn(TARGET)).resolves.toBeDefined();
    const browserAct = browsers.actionTurn(TARGET).catch((error: unknown) => error);
    await tick();
    browserTime.set(1_000);
    const error = await browserAct;
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(OwnerDrivingError);
    expect((error as Error).message).toBe(
      "The owner is driving the browser; wait and retry, or continue without the browser.",
    );
    await browsers.closeAll();
  });
});

/** Runs `fn` after `n` microtask hops, so a test can land a call between a manager's awaits. */
async function afterTicks(n: number, fn: () => unknown): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
  fn();
}

const TICKS = [0, 1, 2, 3, 4, 5, 6, 7];

describe("live sessions drift: where the driver is checked", () => {
  it("computer: a read and an action started in the same tick as a takeover request still run", async () => {
    for (const joinOpen of [false, true]) {
      const time = manualClock();
      const fake = fakeComputer();
      const sessions = createComputerSessions({
        transport: fake.transport,
        humanDriverWaitMs: 1_000,
        clock: time.clock,
      });
      const release = joinOpen ? fake.holdOpens() : undefined;
      if (!joinOpen) await sessions.acquire("shared");
      const outcomes: string[] = [];
      void sessions.readTurn("shared").then(
        () => outcomes.push("read ok"),
        (error: Error) => outcomes.push(`read ${error.name}`),
      );
      void sessions.actionTurn("shared").then(
        () => outcomes.push("act ran"),
        (error: Error) => outcomes.push(`act ${error.name}`),
      );
      const takeover = sessions
        .requestTakeover("shared", "x", 50)
        .then((outcome) => outcomes.push(`takeover ${outcome}`));
      release?.();
      await tick();
      expect(outcomes, `joinOpen=${joinOpen}`).toEqual(["read ok", "act ran"]);
      time.set(50);
      await takeover;
      expect(outcomes).toEqual(["read ok", "act ran", "takeover timeout"]);
      await sessions.closeAll();
    }
  });

  it("computer: the driver check runs at the same microtask as before", async () => {
    const reads: string[] = [];
    const acts: string[] = [];
    for (const n of TICKS) {
      const fake = fakeComputer();
      const sessions = createComputerSessions({ transport: fake.transport });
      await sessions.acquire("shared");
      const read = sessions.readTurn("shared").then(
        () => "ok",
        () => "refused",
      );
      await afterTicks(n, () => sessions.setDriver("shared", "human"));
      reads.push(await read);
      await sessions.setDriver("shared", "agent");
      let acted = false;
      void sessions.actionTurn("shared").then(() => (acted = true));
      await afterTicks(n, () => sessions.setDriver("shared", "human"));
      await tick();
      acts.push(acted ? "ran" : "waited");
      await sessions.closeAll();
    }
    // A takeover in the same tick as the call (n = 0) beats the check; one hop later does not.
    expect({ reads, acts }).toEqual({
      reads: ["refused", "ok", "ok", "ok", "ok", "ok", "ok", "ok"],
      acts: ["waited", "ran", "ran", "ran", "ran", "ran", "ran", "ran"],
    });
  });

  it("browser: the driver checks run at the same microtask as before", async () => {
    const reads: string[] = [];
    const acts: string[] = [];
    for (const n of TICKS) {
      const sessions = createBrowserSessions({
        profilesDir: PROFILES,
        transport: browserTransport(async () =>
          browserSession({ openTab: async () => browserSession() }),
        ),
      });
      const one = { profile: "p1", tab: "t1" };
      const two = { profile: "p1", tab: "t2" };
      await sessions.acquire(one);
      await sessions.acquire(two);
      const read = sessions.readTurn(two);
      await afterTicks(n, () => sessions.setDriver(one, "human"));
      const front = (await read).browser.front;
      reads.push(front ?? "none");
      await sessions.setDriver(one, "agent");
      const browser = sessions.get(one)!;
      browser.front = undefined;
      let acted = false;
      const act = sessions.actionTurn(two).then(() => (acted = true));
      await afterTicks(n, () => sessions.setDriver(one, "human"));
      await tick();
      acts.push(`${acted ? "ran" : "waited"}:${browser.front ?? "none"}`);
      await sessions.setDriver(one, "agent");
      await act;
      await sessions.closeAll();
    }
    // The browser checks after the open and the agent's tab: three hops in.
    expect({ reads, acts }).toEqual({
      reads: ["none", "none", "none", "t2", "t2", "t2", "t2", "t2"],
      acts: [
        "waited:none",
        "waited:none",
        "waited:none",
        "ran:t2",
        "ran:t2",
        "ran:t2",
        "ran:t2",
        "ran:t2",
      ],
    });
  });

  it("each call settles at the same microtask as before", async () => {
    /** Microtask hops until `promise` settles. */
    const hops = async (promise: Promise<unknown>): Promise<number> => {
      let settled = false;
      promise.then(
        () => (settled = true),
        () => (settled = true),
      );
      for (let i = 0; i < 100; i++) {
        if (settled) return i;
        await Promise.resolve();
      }
      return -1;
    };

    const fake = fakeComputer();
    const computers = createComputerSessions({ transport: fake.transport });
    const computer: Record<string, number> = {};
    computer.acquire = await hops(computers.acquire("shared"));
    computer.acquireLive = await hops(computers.acquire("shared"));
    computer.start = await hops(computers.start("shared"));
    computer.readTurn = await hops(computers.readTurn("shared"));
    computer.actionTurn = await hops(computers.actionTurn("shared"));
    computer.takeOver = await hops(computers.setDriver("shared", "human"));
    computer.readRefused = await hops(computers.readTurn("shared"));
    computer.handBack = await hops(computers.setDriver("shared", "agent"));
    const takeover = computers.requestTakeover("shared", "x", 60_000);
    await tick();
    const back = computers.setDriver("shared", "agent");
    computer.takeoverAnswered = await hops(takeover);
    await back;
    computer.close = await hops(computers.close("shared"));
    computer.closeAll = await hops(computers.closeAll());

    const browsers = createBrowserSessions({
      profilesDir: PROFILES,
      transport: browserTransport(async () =>
        browserSession({ openTab: async () => browserSession() }),
      ),
    });
    const one = { profile: "p1", tab: "t1" };
    const two = { profile: "p1", tab: "t2" };
    const browser: Record<string, number> = {};
    // A fresh open is left out: its hops include the dynamic `import()` of node:fs.
    await browsers.acquire(one);
    browser.acquireLive = await hops(browsers.acquire(one));
    browser.acquireTab = await hops(browsers.acquire(two));
    browser.start = await hops(browsers.start(one));
    browser.readTurn = await hops(browsers.readTurn(two));
    browser.actionTurn = await hops(browsers.actionTurn(one));
    browser.takeOver = await hops(browsers.setDriver(one, "human"));
    browser.handBack = await hops(browsers.setDriver(one, "agent"));
    browser.closeTab = await hops(browsers.closeTab(two));
    browser.close = await hops(browsers.close(one));
    browser.closeAll = await hops(browsers.closeAll());
    expect({ computer, browser }).toEqual({
      computer: {
        acquire: 9,
        acquireLive: 1,
        start: 3,
        readTurn: 2,
        actionTurn: 2,
        takeOver: 1,
        readRefused: 2,
        handBack: 1,
        takeoverAnswered: 2,
        close: 3,
        closeAll: 3,
      },
      browser: {
        acquireLive: 3,
        acquireTab: 8,
        start: 6,
        readTurn: 6,
        actionTurn: 6,
        takeOver: 1,
        handBack: 2,
        closeTab: 3,
        close: 4,
        closeAll: 3,
      },
    });
  });

  it("browser: the idle sweep does not wake an action waiting on a hand-back in progress", async () => {
    const time = manualClock();
    const log: string[] = [];
    let finishAdopt!: () => void;
    const tab = (name: string): BrowserSession =>
      browserSession({
        close: async () => void log.push(`${name}:close`),
        focus: async () => void log.push(`${name}:focus`),
        adoptActiveTab: () => {
          log.push(`${name}:adopt`);
          return new Promise<void>((resolve) => (finishAdopt = resolve));
        },
        openTab: async () => tab("t2"),
      });
    const sessions = createBrowserSessions({
      profilesDir: PROFILES,
      transport: browserTransport(async () => tab("t1")),
      idleMinutes: 1,
      humanDriverWaitMs: 600_000,
      clock: time.clock,
    });
    const a = { profile: "p", tab: "a" };
    const b = { profile: "p", tab: "b" };
    await sessions.acquire(a);
    await sessions.acquire(b);
    await sessions.setDriver(a, "human");
    const act = sessions.actionTurn(b).then(() => void log.push("act resolved"));
    await tick();
    time.set(5 * 60_000);
    const handBack = sessions.setDriver(a, "agent").then(() => void log.push("handback resolved"));
    time.sweep(); // the browser idled out while the owner drove; the hand-back is still adopting
    await tick();
    log.push("adopt done");
    finishAdopt();
    await handBack;
    await act;
    // The sweep closed the browser, but the action still woke only with the hand-back.
    expect(log).toEqual([
      "t1:adopt",
      "t1:close",
      "adopt done",
      "t2:focus",
      "handback resolved",
      "act resolved",
    ]);
    await sessions.closeAll();
  });
});

/** A desktop that answers every call with nothing. */
function fakeDesktop(): ComputerDesktop {
  const none = async () => {};
  return {
    width: 1280,
    height: 800,
    screenshot: async () => Buffer.alloc(0),
    cursorPosition: async () => ({ x: 0, y: 0 }),
    click: none,
    move: none,
    drag: none,
    scroll: none,
    type: none,
    key: none,
    listWindows: async () => [],
    focusWindow: none,
    closeWindow: none,
    listApps: async () => [],
    openApp: none,
    clipboardGet: async () => "",
    clipboardSet: none,
    typeSecret: none,
    close: none,
  };
}
