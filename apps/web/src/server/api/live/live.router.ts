import { routes, type Routes } from "../routes";
import { z, type ZodType } from "zod";
import type { AppContext } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseStringParam, requireUser } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import * as botsService from "../bots/bots.service";
import { browserTargetForBot } from "../bots/browser.targets";
import { knownProfile } from "./profiles";
import { watchOnly } from "../people/access";
import type { DesktopApp, DesktopApps, LiveStarting, VncTicket } from "../../../shared/api/live";

export const OWNER_TAB = "owner";

type Driver = "agent" | "human";

export interface LiveAddress {
  profile: string;
  tab: string;
}

interface LiveEntry {
  driver: Driver;
  lastActivity: number;
}

interface LiveView {
  scale: number;
  resize?(width: number, height: number): Promise<void>;
}

interface LiveOps<L extends LiveEntry> {
  get(at: LiveAddress): L | undefined;
  start(at: LiveAddress): Promise<unknown>;
  setDriver(at: LiveAddress, driver: Driver): Promise<void>;
  reset(at: LiveAddress): Promise<void>;
}

interface TicketRequest {
  userId: number;
  at: LiveAddress;
  scope: string;
  viewOnly: boolean;
}

interface Addressed {
  notRunning: string;
  issueTicket(request: TicketRequest): string;
}

export interface LiveSurface<L extends LiveEntry> {
  name: string;
  ops(): LiveOps<L>;
  view(live: L): LiveView | undefined;
  noView: string;
  resetFailed: string;
  touchOnTakeover: boolean;
  resize?: { cannot: string; failed: string };
  apps?: {
    list(live: L): Promise<DesktopApp[]>;
    open(live: L, id: string): Promise<void>;
    notDriving: string;
    listFailed: string;
    openFailed: string;
  };
  profiles: Addressed & {
    notFound: string;
    list(): Promise<unknown>;
  };
  bots: Addressed & {
    status(at: LiveAddress): unknown;
    bodyBeforeBot: boolean;
    opensTabForTicket: boolean;
    noViewIsNotRunning: boolean;
  };
}

const driverSchema = z.object({ driver: z.enum(["agent", "human"]) });

const resizeSchema = z.object({
  width: z.number().int().min(320).max(4096),
  height: z.number().int().min(240).max(4096),
});

const openAppSchema = z.object({ id: z.string().min(1).max(128) });

interface Resolved {
  at: LiveAddress;
  scope: string;
}

interface Addressing extends Addressed {
  base: string;
  reset: string;
  resolve(c: AppContext): Promise<Resolved>;
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
    withBody: async (c, schema) => {
      const resolved = await resolve(c);
      return [resolved, await parseBody(c, schema)];
    },
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
          const resolved = await resolve(c);
          return [resolved, await parseBody(c, schema)];
        },
    vncPath: (id) => `/api/v1/bots/${encodeURIComponent(id)}/${name}/vnc`,
  };
}

function badGateway(error: unknown, fallback: string): never {
  throw Boom.badGateway(error instanceof Error ? error.message : fallback);
}

function logFailedStart(error: unknown, route: string): void {
  logger.warn({ error, route }, "Live: the session did not start");
}

function register(router: Routes, surface: LiveSurface<LiveEntry>, a: Addressing): void {
  router.post(`${a.base}/start`, "signedIn", async (c) => {
    const { at } = await a.resolve(c);
    surface
      .ops()
      .start(at)
      .catch((error: unknown) => logFailedStart(error, a.base));
    return ok<LiveStarting>(c, { starting: true });
  });

  router.post(`${a.base}/vnc-ticket`, "signedIn", async (c) => {
    const { at, scope } = await a.resolve(c);
    const ops = surface.ops();
    const live = ops.get(at);
    const view = live && surface.view(live);
    if (!live || (!view && a.noViewIsNotRunning)) throw Boom.notFound(a.notRunning);
    if (!view) throw Boom.conflict(surface.noView);
    if (a.opensTabForTicket) {
      await ops.start(at).catch((error: unknown) => logFailedStart(error, a.base));
    }
    const ticket = a.issueTicket({
      userId: requireUser(c).userId,
      at,
      scope,
      viewOnly: watchOnly(c.get("viewer")),
    });
    live.lastActivity = Date.now();
    return ok<VncTicket>(c, { path: `${a.vncPath(scope)}?ticket=${ticket}`, scale: view.scale });
  });

  const { resize } = surface;
  if (resize) {
    router.post(`${a.base}/resize`, "signedIn", async (c) => {
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

  router.post(`${a.base}/driver`, "signedIn", async (c) => {
    const [{ at }, body] = await a.withBody(c, driverSchema);
    const ops = surface.ops();
    const live = ops.get(at);
    if (!live) throw Boom.notFound(a.notRunning);
    await ops.setDriver(at, body.driver);
    if (surface.touchOnTakeover && body.driver === "human") live.lastActivity = Date.now();
    return ok(c, { driver: body.driver });
  });
}

function registerApps(router: Routes, surface: LiveSurface<LiveEntry>, a: Addressing): void {
  const { apps } = surface;
  if (!apps) return;
  router.get(`${a.base}/apps`, async (c) => {
    const { at } = await a.resolve(c);
    const live = surface.ops().get(at);
    if (!live) throw Boom.notFound(a.notRunning);
    try {
      return ok<DesktopApps>(c, { apps: await apps.list(live) });
    } catch (error) {
      badGateway(error, apps.listFailed);
    }
  });

  router.post(`${a.base}/apps`, "signedIn", async (c) => {
    const [{ at }, body] = await a.withBody(c, openAppSchema);
    const live = surface.ops().get(at);
    if (!live) throw Boom.notFound(a.notRunning);
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

function registerReset(router: Routes, surface: LiveSurface<LiveEntry>, a: Addressing): void {
  router.delete(a.reset, "signedIn", async (c) => {
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

export function liveRouter(surfaces: LiveSurface<LiveEntry>[]): Routes["hono"] {
  const router = routes();
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
  return router.hono;
}
