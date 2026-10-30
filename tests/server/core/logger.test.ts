import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  addBreadcrumb,
  configureLogger,
  createLogger,
  getBreadcrumbs,
  getLoggerSettings,
  logPerformance,
  logger,
  runWithRequestContext,
  type LogRecord,
} from "@groot/core/logger";

const original = { ...getLoggerSettings() };
afterEach(() => configureLogger(original));

function capture() {
  const records: LogRecord[] = [];
  configureLogger({
    level: "trace",
    pretty: false,
    write: (_level, _line, record) => records.push(record),
  });
  return records;
}

describe("logger", () => {
  it("filters by level and serialises errors", () => {
    const records = capture();
    configureLogger({ level: "warn" });
    logger.info("dropped");
    logger.warn({ code: 1 }, "kept");
    logger.error(new Error("boom"));
    expect(records.map((r) => r.msg)).toEqual(["kept", "boom"]);
    expect(records[0]).toMatchObject({ level: "warn", code: 1 });
    expect((records[1]!.err as { message: string }).message).toBe("boom");
  });

  it("child loggers carry bindings", () => {
    const records = capture();
    createLogger({ service: "x" }).child({ reqId: "r1" }).info("hi");
    expect(records[0]).toMatchObject({ service: "x", reqId: "r1", msg: "hi" });
  });

  it("logPerformance escalates slow operations", () => {
    const records = capture();
    logPerformance({ operation: "fast", duration: 10 });
    logPerformance({ operation: "slow", duration: 6000 });
    expect(records.map((r) => r.level)).toEqual(["debug", "warn"]);
  });

  it("breadcrumbs live in the request context", () => {
    addBreadcrumb("db", "outside"); // dropped
    expect(getBreadcrumbs()).toEqual([]);
    runWithRequestContext({}, () => {
      addBreadcrumb("db", "query", "debug", { ms: 1 });
      expect(getBreadcrumbs()).toHaveLength(1);
      expect(getBreadcrumbs()[0]).toMatchObject({
        category: "db",
        message: "query",
        level: "debug",
      });
    });
  });
});
