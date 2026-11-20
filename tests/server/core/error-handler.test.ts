import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";
import { Boom, ErrorCode } from "@groot/core/errors";
import { createLogger, type LogRecord } from "@groot/core/logger";
import { errorHandler } from "@groot/core/middlewares/error-handler.middleware";
import type { AppEnv } from "@groot/core/types";

function appThrowing(error: Error, records: LogRecord[]) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set("logger", createLogger({}, { sink: (record) => records.push(record) }));
    await next();
  });
  app.get("/boom", () => {
    throw error;
  });
  app.onError(errorHandler);
  return app;
}

async function logged(error: Error) {
  const records: LogRecord[] = [];
  const res = await appThrowing(error, records).request("/boom");
  return { status: res.status, records };
}

describe("errorHandler logging", () => {
  it("logs the session guard's 401 at debug, without a stack", async () => {
    const { status, records } = await logged(
      Boom.unauthorized("No token provided", undefined, ErrorCode.SESSION_INVALID.code),
    );
    expect(status).toBe(401);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "debug",
      msg: "Operational error: No token provided",
    });
    expect((records[0].error as Record<string, unknown>).stack).toBeUndefined();
  });

  it("logs other 4xx errors at warn, without a stack", async () => {
    const { status, records } = await logged(Boom.notFound("No such bot"));
    expect(status).toBe(404);
    expect(records[0]).toMatchObject({ level: "warn", msg: "Operational error: No such bot" });
    expect((records[0].error as Record<string, unknown>).stack).toBeUndefined();
  });

  it("logs system errors at error, with the stack", async () => {
    const { status, records } = await logged(new Error("kaboom"));
    expect(status).toBe(500);
    expect(records[0]).toMatchObject({ level: "error", msg: "System error: kaboom" });
    expect((records[0].error as Record<string, unknown>).stack).toContain("kaboom");
  });
});
