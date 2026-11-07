import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@groot/core/types";
import { Boom } from "@groot/core/errors";
import { GUEST_ACCESS } from "../../../shared/guest-access";
import { canOpenBot, viewerOf, type Viewer } from "./people.service";

declare module "hono" {
  interface ContextVariableMap {
    /** Set by `guestGuard` on every protected request. */
    viewer: Viewer;
  }
}

const GUEST_API = Object.values(GUEST_ACCESS).flatMap((feature) => feature.api);

/** The rule a guest's request matches, with the bot it names; undefined = owner only. */
export function matchGuestRoute(method: string, path: string): { botId?: string } | undefined {
  for (const rule of GUEST_API) {
    if (rule.methods !== "*" && !rule.methods.includes(method)) continue;
    const match = rule.path.exec(path);
    if (match) return match.groups?.bot ? { botId: decodeURIComponent(match.groups.bot) } : {};
  }
  return undefined;
}

/**
 * Runs after the JWT middleware, mounted at the API root (`/api/v1`). Sets
 * `viewer`; for a guest, refuses anything outside `GUEST_ACCESS` and any bot
 * not shared with them.
 */
export function guestGuard(prefix = "/api/v1"): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) throw Boom.unauthorized("Authentication required");
    const viewer = await viewerOf(user.userId);
    c.set("viewer", viewer);
    if (!viewer.guest) return next();
    const path = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : c.req.path;
    const allowed = matchGuestRoute(c.req.method, path);
    if (!allowed) throw Boom.forbidden("Only the owner can do that");
    if (allowed.botId !== undefined && !(await canOpenBot(viewer, allowed.botId))) {
      throw Boom.notFound("Bot not found");
    }
    return next();
  };
}
