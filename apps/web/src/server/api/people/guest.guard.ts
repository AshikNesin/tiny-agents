/**
 * What a guest may reach (issue #145): the bots shared with them (chat,
 * approvals, live browser and computer views), uploads, Code and their own
 * account. Everything else is the owner's and answers 403. Default-deny: a
 * route added later is closed to guests until it is listed here.
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@groot/core/types";
import { Boom } from "@groot/core/errors";
import { canOpenBot, viewerOf, type Viewer } from "./people.service";

declare module "hono" {
  interface ContextVariableMap {
    /** Set by `guestGuard` on every protected request. */
    viewer: Viewer;
  }
}

type Rule = { methods: readonly string[] | "*"; path: RegExp };

const READ = ["GET", "HEAD"] as const;

/** Routes a guest may call. A `(?<bot>…)` group must be a bot shared with them. */
const GUEST_ROUTES: Rule[] = [
  { methods: READ, path: /^\/people\/me$/ },
  { methods: READ, path: /^\/(models|capabilities|claude-code\/status|events)$/ },
  { methods: READ, path: /^\/bots$/ },
  { methods: READ, path: /^\/bots\/(?<bot>[^/]+)$/ },
  {
    methods: "*",
    path: /^\/bots\/(?<bot>[^/]+)\/(stream|messages(\/[^/]+)?|abort|read|approvals\/\d+|questions\/\d+)$/,
  },
  // Live views of the bot's browser and computer; deleting a profile stays the owner's.
  {
    methods: [...READ, "POST"],
    path: /^\/bots\/(?<bot>[^/]+)\/(browser|computer)(\/(start|vnc-ticket|resize|driver))?$/,
  },
  { methods: "*", path: /^\/uploads(\/.*)?$/ },
  { methods: "*", path: /^\/code(\/.*)?$/ },
];

/** The rule a guest's request matches, with the bot it names; undefined = owner only. */
export function matchGuestRoute(method: string, path: string): { botId?: string } | undefined {
  for (const rule of GUEST_ROUTES) {
    if (rule.methods !== "*" && !rule.methods.includes(method)) continue;
    const match = rule.path.exec(path);
    if (match) return match.groups?.bot ? { botId: decodeURIComponent(match.groups.bot) } : {};
  }
  return undefined;
}

/**
 * Runs after the JWT middleware, mounted at the API root (`/api/v1`). Sets
 * `viewer`; for a guest, refuses anything outside `GUEST_ROUTES` and any bot
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
