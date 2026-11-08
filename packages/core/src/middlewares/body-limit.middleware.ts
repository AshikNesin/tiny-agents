import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { matchedRoutes } from "hono/route";
import { COMPOSED_HANDLER } from "hono/utils/constants";
import type { AppContext, Middleware } from "../types";

/**
 * Request body limits. `createApp()` caps every `/api/*` body at
 * `bodyLimitBytes` (1 MB) with `defaultBodyLimit`; a router whose routes take
 * bigger (or smaller) bodies declares its own with `routeBodyLimit`, and the
 * default steps aside for any request that one of those routes matches. The
 * route owns its limit, so it holds wherever the router is mounted.
 *
 * Both are Hono's `bodyLimit`: a declared `Content-Length` over the limit is
 * refused before the body is read, and a streamed (chunked) body is counted
 * as it arrives and refused as soon as it passes the limit.
 */

const routeLimits = new WeakSet<MiddlewareHandler>();

/**
 * A body limit for the routes it is registered on, in place of the app's
 * default: `router.post("/upload", routeBodyLimit(100 * 1024 * 1024), handler)`.
 */
export function routeBodyLimit(maxSize: number): Middleware {
  const middleware = bodyLimit({ maxSize });
  routeLimits.add(middleware);
  return middleware;
}

/**
 * True when a route this request matches declared its own limit. Hono matches
 * every handler for a request before running the first, so the app-level
 * default can see the route's limit ahead of it. `app.route()` wraps a sub-app
 * handler when the sub-app has its own `onError`; the original rides along
 * under `COMPOSED_HANDLER`.
 */
function routeOwnsBodyLimit(c: AppContext): boolean {
  return matchedRoutes(c).some(({ handler }) => {
    const original = (handler as { [COMPOSED_HANDLER]?: MiddlewareHandler })[COMPOSED_HANDLER];
    return routeLimits.has(handler) || (original !== undefined && routeLimits.has(original));
  });
}

/** The app's body limit, skipped for requests a `routeBodyLimit` route matches or `skip` accepts. */
export function defaultBodyLimit(maxSize: number, skip?: (c: AppContext) => boolean): Middleware {
  const limit = bodyLimit({ maxSize });
  return (c, next) => (routeOwnsBodyLimit(c) || skip?.(c) ? next() : limit(c, next));
}
