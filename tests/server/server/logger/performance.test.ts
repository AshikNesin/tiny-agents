import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * logPerformance — the standardized ops record for anything with a duration.
 * Level escalates with duration (debug < 1s, info < 5s, warn beyond) so slow
 * operations surface in ops dashboards without log-grepping.
 *
 * `logger` is a stable Proxy over the active pino instance; pino writes
 * through SonicBoom (fd-level, not interceptable), so we replace the pino
 * factory with a recording fake and assert on the forwarded calls.
 */
type Record = { level: string; obj: Record<string, unknown>; msg: string };
const records: Record[] = [];

vi.mock("pino", () => {
  const makeRecordingLogger = () => {
    const write = (level: string) => (obj: Record<string, unknown>, msg: string) => {
      records.push({ level, obj, msg });
    };
    return {
      debug: write("debug"),
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
      fatal: write("fatal"),
      trace: write("trace"),
      child: () => makeRecordingLogger(),
    };
  };
  const pinoFn = () => makeRecordingLogger();
  return {
    default: Object.assign(pinoFn, {
      stdSerializers: { req: (x: unknown) => x, res: (x: unknown) => x, err: (x: unknown) => x },
    }),
  };
});

// Import after the mock is registered.
const { configureLogger, logPerformance } = await import("@groot/core/logger");

beforeEach(() => {
  records.length = 0;
  configureLogger({ level: "debug", service: "perf-test", nodeEnv: "test" });
});

describe("logPerformance", () => {
  it("escalates level with duration (debug < 1s, info < 5s, warn beyond)", () => {
    logPerformance({ operation: "fast", duration: 100 });
    logPerformance({ operation: "medium", duration: 2000 });
    logPerformance({ operation: "slow", duration: 9000 });

    expect(records.map((r) => r.level)).toEqual(["debug", "info", "warn"]);
    expect(records.map((r) => r.obj.operation)).toEqual(["fast", "medium", "slow"]);
  });

  it("includes operation, duration and extra data in the record", () => {
    logPerformance({
      operation: "job_extract",
      duration: 420,
      data: { jobId: "jb_1", extracted: 12 },
    });

    expect(records).toHaveLength(1);
    expect(records[0].obj).toMatchObject({
      type: "performance",
      operation: "job_extract",
      duration: "420ms",
      jobId: "jb_1",
      extracted: 12,
    });
    expect(records[0].msg).toBe("Performance: job_extract completed in 420ms");
  });

  it("defaults data to empty (no spread noise)", () => {
    logPerformance({ operation: "bare", duration: 10 });
    expect(records[0].obj).toEqual({ type: "performance", operation: "bare", duration: "10ms" });
  });
});
