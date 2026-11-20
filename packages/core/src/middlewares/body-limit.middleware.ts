import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { matchedRoutes } from "hono/route";
import { COMPOSED_HANDLER } from "hono/utils/constants";
import type { AppContext, Middleware } from "../types";

const routeLimits = new WeakSet<MiddlewareHandler>();

export interface RouteBodyLimitOptions {
  onError?: (c: AppContext) => Response | Promise<Response>;
}

export function routeBodyLimit(maxSize: number, options: RouteBodyLimitOptions = {}): Middleware {
  const middleware = bodyLimit({ maxSize, onError: options.onError });
  routeLimits.add(middleware);
  return middleware;
}

function routeOwnsBodyLimit(c: AppContext): boolean {
  return matchedRoutes(c).some(({ handler }) => {
    const original = (handler as { [COMPOSED_HANDLER]?: MiddlewareHandler })[COMPOSED_HANDLER];
    return routeLimits.has(handler) || (original !== undefined && routeLimits.has(original));
  });
}

export function defaultBodyLimit(maxSize: number, skip?: (c: AppContext) => boolean): Middleware {
  const limit = bodyLimit({ maxSize });
  return (c, next) => (routeOwnsBodyLimit(c) || skip?.(c) ? next() : limit(c, next));
}
