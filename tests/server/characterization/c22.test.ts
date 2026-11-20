import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  createComputerSessions,
  type ComputerSessions,
} from "../../../packages/sandbox/src/computer-sessions";
import type { BrowserClock } from "../../../packages/sandbox/src/browser-sessions";
import { fakeComputer } from "../app/agent/computer-fakes";

function manualClock() {
  let now = 0;
  let nextId = 1;
  const timeouts = new Map<number, { at: number; fn: () => void }>();
  const intervals: (() => void)[] = [];
  const clock: BrowserClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
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
    advance(ms: number) {
      now += ms;
      for (const [id, timeout] of timeouts) {
        if (timeout.at <= now) {
          timeouts.delete(id);
          timeout.fn();
        }
      }
    },
    sweep: () => intervals.forEach((tick) => tick()),
  };
}

const managers: ComputerSessions[] = [];
afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map((manager) => manager.closeAll()));
});

describe("C22: a takeover nobody answers", () => {
  it("times out with the driver left `human`, and the idle sweep then never closes the desktop", async () => {
    const time = manualClock();
    const fake = fakeComputer();
    const sessions = createComputerSessions({
      transport: fake.transport,
      idleMinutes: 1,
      clock: time.clock,
    });
    managers.push(sessions);

    const outcome = sessions.requestTakeover("shared", "Sign in to the mail app", 60_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    time.advance(60_000);
    expect(await outcome).toBe("timeout");

    const live = sessions.get("shared");
    expect(live?.driver).toBe("human");
    expect(live?.takeover).toEqual({ reason: "Sign in to the mail app", since: 0 });

    for (let hour = 0; hour < 24; hour++) {
      time.advance(60 * 60_000);
      time.sweep();
    }
    expect(sessions.profiles()).toEqual(["shared"]);
    expect(fake.log.filter((entry) => entry.method === "close")).toEqual([]);

    await sessions.setDriver("shared", "agent");
    time.advance(2 * 60_000);
    time.sweep();
    expect(sessions.profiles()).toEqual([]);
  });
});
