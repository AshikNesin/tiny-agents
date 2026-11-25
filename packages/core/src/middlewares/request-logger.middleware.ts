import { createMiddleware } from "hono/factory";
import { runWithRequestContext } from "../context";
import { logger } from "../logger";
import { clientIp } from "../utils/controller.utils";
import { redactSecretPath } from "../utils/redact-path";
import type { AppEnv } from "../types";

const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const requestLoggerMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const supplied = c.req.header("x-request-id");
  const requestId = supplied && CLIENT_REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
  const startTime = Date.now();

  let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
  try {
    const executionCtx = c.executionCtx;
    waitUntil = (promise) => executionCtx.waitUntil(promise);
  } catch {
    waitUntil = undefined;
  }

  const path = redactSecretPath(c.req.path);
  const log = logger.child({
    reqId: requestId,
    method: c.req.method,
    url: path,
    userAgent: c.req.header("user-agent"),
    ip: clientIp(c),
  });
  c.set("requestId", requestId);
  c.set("logger", log);
  c.header("x-request-id", requestId);

  await runWithRequestContext({ requestId, startTime, waitUntil }, async () => {
    await next();
    const duration = Date.now() - startTime;
    const status = c.res.status;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    log[level](
      { statusCode: status, duration: `${duration}ms` },
      `${c.req.method} ${path} → ${status} in ${duration}ms`,
    );
  });
});
