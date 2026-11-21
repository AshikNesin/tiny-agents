import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createLifecycle, type LifecyclePart } from "../../../../apps/web/src/server/lifecycle";

function harness(options: { stopDeadlineMs?: number } = {}) {
  const log = { info: vi.fn(), warn: vi.fn() };
  const exit = vi.fn();
  const lifecycle = createLifecycle({ log, exit, ...options });
  const events: string[] = [];
  const part = (name: string, extra: Partial<LifecyclePart> = {}): LifecyclePart => ({
    name,
    start: () => void events.push(`start ${name}`),
    stop: () => void events.push(`stop ${name}`),
    ...extra,
  });
  return { lifecycle, log, exit, events, part };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("lifecycle", () => {
  it("refuses a part added before a part it needs, and keeps the declared order", async () => {
    const { lifecycle, events, part } = harness();
    lifecycle.add(part("db"));
    expect(() => lifecycle.add(part("jobs", { needs: ["runtime"] }))).toThrow(
      'Part "jobs" needs "runtime", which must be added before it',
    );
    lifecycle.add(part("runtime", { needs: ["db"] }));
    lifecycle.add(part("jobs", { needs: ["db", "runtime"] }));
    await lifecycle.start();
    await lifecycle.stop("test");
    expect(events).toEqual([
      "start db",
      "start runtime",
      "start jobs",
      "stop jobs",
      "stop runtime",
      "stop db",
    ]);
  });

  it("starts parts in order and stops them in reverse", async () => {
    const { lifecycle, events, part } = harness();
    lifecycle.add(part("runtime"));
    lifecycle.add(part("listeners"));
    lifecycle.add(part("http"));
    await lifecycle.start();
    expect(await lifecycle.stop("test")).toBe(true);
    expect(events).toEqual([
      "start runtime",
      "start listeners",
      "start http",
      "stop http",
      "stop listeners",
      "stop runtime",
    ]);
  });

  it("stops what already started when a start fails, and rethrows", async () => {
    const { lifecycle, events, part } = harness();
    lifecycle.add(part("runtime"));
    lifecycle.add(
      part("http", {
        start: () => {
          throw new Error("port in use");
        },
      }),
    );
    lifecycle.add(part("workers"));
    await expect(lifecycle.start()).rejects.toThrow("port in use");
    expect(events).toEqual(["start runtime", "stop runtime"]);
  });

  it("keeps stopping past a part whose stop fails, and reports it", async () => {
    const { lifecycle, events, part, log } = harness();
    lifecycle.add(part("runtime"));
    lifecycle.add(
      part("connections", {
        stop: async () => {
          throw new Error("socket hung up");
        },
      }),
    );
    lifecycle.add(part("http"));
    await lifecycle.start();
    expect(await lifecycle.stop("test")).toBe(false);
    expect(events).toEqual([
      "start runtime",
      "start connections",
      "start http",
      "stop http",
      "stop runtime",
    ]);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ part: "connections" }),
      expect.stringContaining("failed to stop"),
    );
  });

  it("gives up on a stop that never finishes once the deadline passes", async () => {
    vi.useFakeTimers();
    const { lifecycle, events, part, log } = harness({ stopDeadlineMs: 1_000 });
    lifecycle.add(part("runtime"));
    lifecycle.add(part("hung", { stop: () => new Promise<never>(() => undefined) }));
    await lifecycle.start();
    const stopped = lifecycle.stop("test");
    await vi.advanceTimersByTimeAsync(999);
    expect(events).toEqual(["start runtime", "start hung"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await stopped).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ part: "hung" }),
      expect.stringContaining("did not finish"),
    );
  });

  it("stops once: a second stop returns the first outcome", async () => {
    const { lifecycle, events, part } = harness();
    lifecycle.add(part("runtime"));
    await lifecycle.start();
    const [first, second] = await Promise.all([lifecycle.stop("a"), lifecycle.stop("b")]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(events).toEqual(["start runtime", "stop runtime"]);
  });

  it("stops and exits 0 on the first signal, exits at once on the second", async () => {
    const { lifecycle, events, part, exit } = harness();
    let release!: () => void;
    lifecycle.add(
      part("slow", { stop: () => new Promise<void>((resolve) => (release = resolve)) }),
    );
    await lifecycle.start();
    const unhook = lifecycle.handleSignals(["SIGTERM"]);
    try {
      process.emit("SIGTERM");
      await Promise.resolve();
      expect(exit).not.toHaveBeenCalled();
      process.emit("SIGTERM");
      expect(exit).toHaveBeenCalledWith(130);
      release();
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
      expect(events).toEqual(["start slow"]);
    } finally {
      unhook();
    }
  });

  it("exits 1 when a signal-driven stop was not clean", async () => {
    const { lifecycle, part, exit } = harness();
    lifecycle.add(
      part("bad", {
        stop: () => {
          throw new Error("nope");
        },
      }),
    );
    await lifecycle.start();
    const unhook = lifecycle.handleSignals(["SIGINT"]);
    try {
      process.emit("SIGINT");
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    } finally {
      unhook();
    }
  });
});
