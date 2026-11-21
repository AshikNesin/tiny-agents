import { describe, expect, it } from "vite-plus/test";
import {
  createBrowserSessions,
  type BrowserClock,
  type BrowserSession,
  type BrowserTransport,
} from "../../../../packages/sandbox/src/browser-sessions";
import { createComputerSessions } from "../../../../packages/sandbox/src/computer-sessions";
import { fakeComputer } from "./computer-fakes";

const MINUTE = 60_000;

function manualClock() {
  let now = 0;
  const intervals: (() => void)[] = [];
  const clock: BrowserClock = {
    now: () => now,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    setInterval: (fn) => {
      intervals.push(fn);
      return 0;
    },
    clearInterval: () => undefined,
  };
  return {
    clock,
    at(ms: number) {
      now = ms;
      intervals.forEach((tick) => tick());
    },
    set(ms: number) {
      now = ms;
    },
  };
}

describe("owner idle hand-back", () => {
  it("computer: two minutes without the owner's input hands the desktop back", async () => {
    const time = manualClock();
    const computers = createComputerSessions({
      transport: fakeComputer().transport,
      clock: time.clock,
    });
    await computers.acquire("shared");
    await computers.setDriver("shared", "human");
    time.set(1.5 * MINUTE);
    computers.ownerInput("shared");
    time.at(3 * MINUTE);
    expect(computers.get("shared")?.driver).toBe("human");
    time.at(3.6 * MINUTE);
    expect(computers.get("shared")?.driver).toBe("agent");
    expect(computers.profiles()).toEqual(["shared"]);
    await computers.closeAll();
  });

  it("computer: a bot's takeover request waits for the owner, then ends once they go idle", async () => {
    const time = manualClock();
    const computers = createComputerSessions({
      transport: fakeComputer().transport,
      clock: time.clock,
    });
    const outcome = computers.requestTakeover("shared", "Sign in", 30 * MINUTE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    time.at(5 * MINUTE);
    expect(computers.get("shared")?.driver).toBe("human");
    computers.ownerInput("shared");
    time.at(7.5 * MINUTE);
    expect(await outcome).toBe("released");
    expect(computers.get("shared")?.driver).toBe("agent");
    await computers.closeAll();
  });

  it("browser: two minutes without the owner's input hands the browser back", async () => {
    const time = manualClock();
    const session = {
      url: () => "about:blank",
      close: async () => {},
    } as unknown as BrowserSession;
    const transport: BrowserTransport = Object.assign(async () => session, {
      wipe: async () => {},
    });
    const browsers = createBrowserSessions({
      profilesDir: "/tmp/ta-owner-idle",
      transport,
      clock: time.clock,
    });
    const target = { profile: "p1", tab: "t1" };
    await browsers.acquire(target);
    await browsers.setDriver(target, "human");
    time.at(2.5 * MINUTE);
    expect(browsers.get(target)?.driver).toBe("agent");
    await browsers.closeAll();
  });
});
