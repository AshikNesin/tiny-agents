import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { matchedRoutes } from "hono/route";
import { COMPOSED_HANDLER } from "hono/utils/constants";
import type { AppContext, Middleware } from "../types";

const routeLimits = new WeakMap<MiddlewareHandler, RouteBodyLimitOptions & { maxSize: number }>();

export interface RouteBodyLimitOptions {
  onError?: (c: AppContext) => Response | Promise<Response>;
}

export function routeBodyLimit(maxSize: number, options: RouteBodyLimitOptions = {}): Middleware {
  const middleware = bodyLimit({ maxSize, onError: options.onError });
  routeLimits.set(middleware, { maxSize, onError: options.onError });
  return middleware;
}

function limitOf(
  handler: MiddlewareHandler,
): (RouteBodyLimitOptions & { maxSize: number }) | undefined {
  const original = (handler as { [COMPOSED_HANDLER]?: MiddlewareHandler })[COMPOSED_HANDLER];
  return (
    routeLimits.get(handler) ?? (original !== undefined ? routeLimits.get(original) : undefined)
  );
}

export function defaultBodyLimit(maxSize: number, skip?: (c: AppContext) => boolean): Middleware {
  const defaultLimit = bodyLimit({ maxSize });
  const middleware: Middleware = (c, next) => {
    if (skip?.(c)) return next();
    const handlers = matchedRoutes(c).map((route) => route.handler);

    const routes = handlers.slice(handlers.indexOf(middleware) + 1);

    if (routes.length > 0 && limitOf(routes[0]!) !== undefined) return next();

    const declared = routes.map(limitOf).filter((limit) => limit !== undefined);
    const routeLimit = Math.max(-1, ...declared.map((limit) => limit.maxSize));
    if (routeLimit < 0) return defaultLimit(c, next);
    const worded = declared.find((limit) => limit.maxSize === routeLimit && limit.onError);
    return bodyLimit({ maxSize: routeLimit, onError: worded?.onError })(c, next);
  };
  return middleware;
}
