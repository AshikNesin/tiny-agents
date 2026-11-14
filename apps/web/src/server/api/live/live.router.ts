/**
 * The live views' routes (rewrite step 4.3): one router per surface, the
 * bots' browsers or their desktops, addressed by profile, plus the per-bot
 * aliases the chat's panels call, which resolve the bot to its profile and
 * run the same handlers. All JWT-protected, mounted at the API root.
 *
 * By profile (`shared`, or `bot-<id>` for a bot with a profile of its own,
 * `../bots/profiles.ts`), owner only (GUEST_ACCESS lists none of them):
 *
 *     GET    /<surface>                       every profile, with its status
 *     POST   /<surface>/:profile/start        open in the background
 *     POST   /<surface>/:profile/vnc-ticket   a one-time ticket for the viewer
 *     POST   /<surface>/:profile/resize       fit the window (`resize` surfaces)
 *     POST   /<surface>/:profile/driver       take control, or hand back
 *     GET    /<surface>/:profile/apps         the desktop's apps (`apps` surfaces)
 *     POST   /<surface>/:profile/apps         open one, while the owner drives
 *     DELETE /<surface>/:profile              close and wipe the profile
 *
 * By bot, the same under /bots/:id/<surface>, with the bot's own status at
 * the root, the reset at `/profile` and no apps. A guest reaches only the
 * status and the ticket of a bot shared with them, and the ticket is watch
 * only (S2).
 *
 * Every path, status code, envelope and error text is what the four
 * hand-written routers answered (D9). Each place they differed is a field of
 * `LiveSurface`, listed in docs/rewrite/README.md (§4.4, `live`) and pinned
 * by tests/server/routes/live-routes-drift.test.ts.
 */
import { Hono } from "hono";
import { z, type ZodType } from "zod";
import type { AppContext, AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseStringParam, requireUser } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import * as botsService from "../bots/bots.service";
import { browserTargetForBot } from "../bots/browser.targets";
import { knownProfile } from "../bots/profiles";

/** The owner's tab in every browser the profile routes open; bot tabs are keyed by bot id. */
export const OWNER_TAB = "owner";

type Driver = "agent" | "human";

/** Where a route acts: a profile, and the tab in it (a browser's; a desktop has none). */
export interface LiveAddress {
  profile: string;
  tab: string;
}

/** A live browser or desktop, as every route reads it. */
interface LiveEntry {
  driver: Driver;
  lastActivity: number;
}

/** A session's live view: its pixel density, and a resize when the window can be fitted. */
interface LiveView {
  scale: number;
  resize?(width: number, height: number): Promise<void>;
}

/** What a surface's manager does for the routes, by address. */
interface LiveOps<L extends LiveEntry> {
  get(at: LiveAddress): L | undefined;
  start(at: LiveAddress): Promise<unknown>;
  setDriver(at: LiveAddress, driver: Driver): Promise<void>;
  /** Close, and wipe the profile. */
  reset(at: LiveAddress): Promise<void>;
}

/** Who a viewer ticket is for; `scope` is the bot id, or the profile. */
interface TicketRequest {
  userId: number;
  at: LiveAddress;
  scope: string;
  viewOnly: boolean;
}

/** What one addressing (by profile, or by bot) says where the surface's two differ. */
interface Addressed {
  /** The 404 when nothing runs at the address. */
  notRunning: string;
  issueTicket(request: TicketRequest): string;
}

export interface LiveSurface<L extends LiveEntry> {
  /** The path segment: `browser` or `computer`. */
  name: string;
  /** The manager's operations; throws (409) when this server has none. */
  ops(): LiveOps<L>;
  /** The live view, or undefined (a headless browser). */
  view(live: L): LiveView | undefined;
  /** The 409 for a ticket without a live view. */
  noView: string;
  /** The 502 when a reset fails without an Error. */
  resetFailed: string;
  /** Touch the idle clock when the owner takes over. */
  touchOnTakeover: boolean;
  /** The resize route, with its 409 and 502 texts; without it, no route. */
  resize?: { cannot: string; failed: string };
  /** The apps routes (by profile only); without them, no route. */
  apps?: {
    list(live: L): Promise<unknown>;
    open(live: L, id: string): Promise<void>;
    notDriving: string;
    listFailed: string;
    openFailed: string;
  };
  profiles: Addressed & {
    /** The 404 for a profile no bot has. */
    notFound: string;
    /**
     * Whether a route that reads a body looks the profile up through a one-step
     * async wrapper (the browser's `ownerTarget`) or hands `knownProfile`'s own
     * promise to `Promise.all` (the computer's `knownDesktop`). The lookup races
     * the body, so the depth decides which refusal a doubly bad request gets.
     */
    lookupInWrapper: boolean;
    /** `GET /<surface>`. */
    list(): Promise<unknown>;
  };
  bots: Addressed & {
    /** `GET /bots/:id/<surface>`. */
    status(at: LiveAddress): unknown;
    /** Read the body, then look the bot up; else both at once, the body listed first. */
    bodyBeforeBot: boolean;
    /** Open the bot's tab before minting its ticket, so the viewer lands on it. */
    opensTabForTicket: boolean;
    /** A live session with no view answers `notRunning` (404), not `noView` (409). */
    noViewIsNotRunning: boolean;
  };
}

const driverSchema = z.object({ driver: z.enum(["agent", "human"]) });

// Floor matches what Chrome renders usefully; the ceiling bounds a hostile
// client, not a real screen.
const resizeSchema = z.object({
  width: z.number().int().min(320).max(4096),
  height: z.number().int().min(240).max(4096),
});

const openAppSchema = z.object({ id: z.string().min(1).max(128) });

interface Resolved {
  at: LiveAddress;
  scope: string;
}

/** One way of naming a live session in a path, and what its routes say. */
interface Addressing extends Addressed {
  /** The routes' prefix; the reset is `DELETE <reset>`. */
  base: string;
  reset: string;
  resolve(c: AppContext): Promise<Resolved>;
  /** The address and the body, in the order the old router read them. */
  withBody<S extends ZodType>(c: AppContext, schema: S): Promise<[Resolved, z.output<S>]>;
  vncPath(scope: string): string;
  opensTabForTicket: boolean;
  noViewIsNotRunning: boolean;
}

function byProfile(surface: LiveSurface<LiveEntry>): Addressing {
  const { name, profiles } = surface;
  const resolve = async (c: AppContext): Promise<Resolved> => {
    const profile = await knownProfile(c.req.param("profile"), profiles.notFound);
    return { at: { profile, tab: OWNER_TAB }, scope: profile };
  };
  return {
    ...profiles,
    base: `/${name}/:profile`,
    reset: `/${name}/:profile`,
    resolve,
    withBody: profiles.lookupInWrapper
      ? (c, schema) => Promise.all([resolve(c), parseBody(c, schema)])
      : (c, schema) =>
          Promise.all([
            knownProfile(c.req.param("profile"), profiles.notFound),
            parseBody(c, schema),
          ]).then(([profile, body]): [Resolved, z.output<typeof schema>] => [
            { at: { profile, tab: OWNER_TAB }, scope: profile },
            body,
          ]),
    // Relative so the client keeps the page's scheme and host behind proxies.
    vncPath: (profile) => `/api/v1/${name}/${encodeURIComponent(profile)}/vnc`,
    opensTabForTicket: false,
    noViewIsNotRunning: false,
  };
}

function byBot(surface: LiveSurface<LiveEntry>): Addressing {
  const { name, bots } = surface;
  const resolve = async (c: AppContext): Promise<Resolved> => {
    const id = parseStringParam(c.req.param("id"), "id");
    return { at: browserTargetForBot(await botsService.getBot(id)), scope: id };
  };
  return {
    ...bots,
    base: `/bots/:id/${name}`,
    reset: `/bots/:id/${name}/profile`,
    resolve,
    withBody: bots.bodyBeforeBot
      ? async (c, schema) => {
          const body = await parseBody(c, schema);
          return [await resolve(c), body];
        }
      : async (c, schema) => {
          const [body, resolved] = await Promise.all([parseBody(c, schema), resolve(c)]);
          return [resolved, body];
        },
    vncPath: (id) => `/api/v1/bots/${encodeURIComponent(id)}/${name}/vnc`,
  };
}

/** A 502 that says why, when the failure says anything. */
function badGateway(error: unknown, fallback: string): never {
  throw Boom.badGateway(error instanceof Error ? error.message : fallback);
}

function register(router: Hono<AppEnv>, surface: LiveSurface<LiveEntry>, a: Addressing): void {
  // Open without a tool call. The first run on a fresh VM installs the stack
  // (minutes), so this returns at once and the client follows the status.
  router.post(`${a.base}/start`, async (c) => {
    const { at } = await a.resolve(c);
    // Also when live: a bot on the shared browser may not have its tab yet,
    // and this brings its tab to the front of the live view.
    surface
      .ops()
      .start(at)
      .catch(() => {
        // The failure is reported by the status (`error`).
      });
    return ok(c, { starting: true });
  });

  router.post(`${a.base}/vnc-ticket`, async (c) => {
    const { at, scope } = await a.resolve(c);
    const ops = surface.ops();
    const live = ops.get(at);
    const view = live && surface.view(live);
    if (!live || (!view && a.noViewIsNotRunning)) throw Boom.notFound(a.notRunning);
    if (!view) throw Boom.conflict(surface.noView);
    // The viewer opens on the bot's tab (made now if the bot has none yet in
    // a shared browser); the stream still works if that fails.
    if (a.opensTabForTicket) await ops.start(at).catch(() => {});
    const ticket = a.issueTicket({
      userId: requireUser(c).userId,
      at,
      scope,
      viewOnly: c.get("viewer").guest,
    });
    live.lastActivity = Date.now();
    return ok(c, { path: `${a.vncPath(scope)}?ticket=${ticket}`, scale: view.scale });
  });

  const { resize } = surface;
  if (resize) {
    // One window per profile: the page and a chat panel both fit it to their
    // view, and the last to connect or resize wins.
    router.post(`${a.base}/resize`, async (c) => {
      const [{ at }, body] = await a.withBody(c, resizeSchema);
      const live = surface.ops().get(at);
      if (!live) throw Boom.notFound(a.notRunning);
      const view = surface.view(live);
      if (!view?.resize) throw Boom.conflict(resize.cannot);
      try {
        await view.resize(body.width, body.height);
      } catch (error) {
        badGateway(error, resize.failed);
      }
      live.lastActivity = Date.now();
      return ok(c, { width: body.width, height: body.height });
    });
  }

  router.post(`${a.base}/driver`, async (c) => {
    const [{ at }, body] = await a.withBody(c, driverSchema);
    const ops = surface.ops();
    const live = ops.get(at);
    if (!live) throw Boom.notFound(a.notRunning);
    // Handing back also answers a bot's takeover request.
    await ops.setDriver(at, body.driver);
    if (surface.touchOnTakeover && body.driver === "human") live.lastActivity = Date.now();
    return ok(c, { driver: body.driver });
  });
}

function registerApps(router: Hono<AppEnv>, surface: LiveSurface<LiveEntry>, a: Addressing): void {
  const { apps } = surface;
  if (!apps) return;
  router.get(`${a.base}/apps`, async (c) => {
    const { at } = await a.resolve(c);
    const live = surface.ops().get(at);
    if (!live) throw Boom.notFound(a.notRunning);
    try {
      return ok(c, { apps: await apps.list(live) });
    } catch (error) {
      badGateway(error, apps.listFailed);
    }
  });

  router.post(`${a.base}/apps`, async (c) => {
    const [{ at }, body] = await a.withBody(c, openAppSchema);
    const live = surface.ops().get(at);
    if (!live) throw Boom.notFound(a.notRunning);
    // The owner acts on the desktop only while the bots on it are paused.
    if (live.driver !== "human") throw Boom.conflict(apps.notDriving);
    try {
      await apps.open(live, body.id);
    } catch (error) {
      badGateway(error, apps.openFailed);
    }
    live.lastActivity = Date.now();
    return ok(c, { opened: body.id });
  });
}

function registerReset(router: Hono<AppEnv>, surface: LiveSurface<LiveEntry>, a: Addressing): void {
  // On the shared profile this resets the browser or desktop every bot on it uses.
  router.delete(a.reset, async (c) => {
    const { at } = await a.resolve(c);
    const ops = surface.ops();
    try {
      await ops.reset(at);
    } catch (error) {
      badGateway(error, surface.resetFailed);
    }
    return ok(c, { reset: true });
  });
}

/** Each surface's per-bot aliases, then its profile routes, in the old routers' order. */
export function liveRouter(surfaces: LiveSurface<LiveEntry>[]): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  for (const surface of surfaces) {
    const bot = byBot(surface);
    router.get(bot.base, async (c) => ok(c, surface.bots.status((await bot.resolve(c)).at)));
    register(router, surface, bot);
    registerReset(router, surface, bot);

    const profile = byProfile(surface);
    router.get(`/${surface.name}`, async (c) => ok(c, await surface.profiles.list()));
    register(router, surface, profile);
    registerApps(router, surface, profile);
    registerReset(router, surface, profile);
  }
  return router;
}
