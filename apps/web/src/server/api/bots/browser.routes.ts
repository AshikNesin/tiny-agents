/**
 * Browser live-view and takeover routes (issue #24). All JWT-protected,
 * mounted under /api/v1/bots/:id/browser.
 *
 * The live view is a full Chrome on the sandbox VM's virtual desktop,
 * streamed over VNC: `POST /vnc-ticket` mints the one-time ticket for the
 * WebSocket in `browser.vnc.ts`, and `POST /resize` fits the browser window
 * to the viewer. Keystrokes travel inside the VNC stream and are never
 * logged. A browser without a VM (local dev, CI) is headless: the agent can
 * use it, but there is nothing to stream, so `mode` reports `headless`.
 *
 * A bot's browser is its profile's (`browser.targets.ts`): bots on the shared
 * profile share one browser, each in its own tab, so taking control, the live
 * view and "Reset" act on that shared browser.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseStringParam, requireUser } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import type { BrowserTarget } from "@tiny-agents/agent/browser";
import * as botsService from "./bots.service";
import { getBrowserSessions } from "./browser.sessions";
import { browserTargetForBot, SHARED_BROWSER_PROFILE } from "./browser.targets";
import { issueVncTicket } from "./browser.vnc";

const router = new Hono<AppEnv>();

const driverSchema = z.object({ driver: z.enum(["agent", "human"]) });

// Floor matches what Chrome renders usefully; the ceiling bounds a hostile
// client, not a real screen.
const resizeSchema = z.object({
  width: z.number().int().min(320).max(4096),
  height: z.number().int().min(240).max(4096),
});

async function botTarget(id: string): Promise<BrowserTarget> {
  return browserTargetForBot(await botsService.getBot(id));
}

function requireSession(target: BrowserTarget) {
  const live = getBrowserSessions().get(target);
  if (!live) throw Boom.notFound("No browser session for this bot yet.");
  return live;
}

router.get("/bots/:id/browser", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const target = await botTarget(id);
  const sessions = getBrowserSessions();
  const live = sessions.get(target);
  const opening = sessions.openState(target);
  return ok(c, {
    active: Boolean(live),
    // "shared" when other bots use this browser (and its logins) too.
    profile: target.profile === SHARED_BROWSER_PROFILE ? "shared" : "own",
    url: live?.tabs.get(target.tab)?.url() ?? null,
    driver: live?.driver ?? null,
    mode: live ? (live.session.vnc ? "vnc" : "headless") : null,
    scale: live?.session.vnc?.scale ?? null,
    // `phase` is `installing` during the one-time VM setup, else `starting`.
    starting: opening.opening,
    phase: opening.opening ? opening.phase : null,
    error: !live && !opening.opening ? (opening.error ?? null) : null,
  });
});

// Open the browser without a tool call. The first run on a fresh VM installs
// Chrome and TigerVNC (minutes), so this returns at once and the client
// follows the status route.
router.post("/bots/:id/browser/start", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const target = await botTarget(id);
  // Also when the browser is live: a bot on the shared profile may not have
  // its tab yet, and this brings its tab to the front of the live view.
  getBrowserSessions()
    .start(target)
    .catch(() => {
      // The failure is reported by the status route (`error`).
    });
  return ok(c, { starting: true });
});

router.post("/bots/:id/browser/vnc-ticket", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const target = await botTarget(id);
  const live = requireSession(target);
  if (!live.session.vnc) {
    throw Boom.conflict("This browser is headless and has no live view.");
  }
  // The viewer opens on this bot's tab (made now if the bot has none yet in
  // a shared browser); the stream still works if that fails.
  await getBrowserSessions()
    .start(target)
    .catch(() => {});
  const ticket = issueVncTicket({
    userId: requireUser(c).userId,
    botId: id,
    target,
    viewOnly: c.get("viewer").guest,
  });
  live.lastActivity = Date.now();
  return ok(c, {
    // Relative so the client keeps the page's scheme and host behind proxies.
    path: `/api/v1/bots/${encodeURIComponent(id)}/browser/vnc?ticket=${ticket}`,
    scale: live.session.vnc.scale,
  });
});

router.post("/bots/:id/browser/resize", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const body = await parseBody(c, resizeSchema);
  const live = requireSession(await botTarget(id));
  if (!live.session.vnc) throw Boom.conflict("This browser cannot be resized.");
  try {
    await live.session.vnc.resize(body.width, body.height);
  } catch (error) {
    throw Boom.badGateway(error instanceof Error ? error.message : "Could not resize the browser.");
  }
  live.lastActivity = Date.now();
  return ok(c, { width: body.width, height: body.height });
});

router.post("/bots/:id/browser/driver", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const body = await parseBody(c, driverSchema);
  const target = await botTarget(id);
  const live = requireSession(target);
  await getBrowserSessions().setDriver(target, body.driver);
  if (body.driver === "human") live.lastActivity = Date.now();
  return ok(c, { driver: body.driver });
});

router.delete("/bots/:id/browser/profile", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const target = await botTarget(id);
  // On the shared profile this signs every bot that uses it out.
  const sessions = getBrowserSessions();
  try {
    await sessions.close(target, { wipeProfile: true });
  } catch (error) {
    throw Boom.badGateway(error instanceof Error ? error.message : "Could not reset the browser.");
  }
  return ok(c, { reset: true });
});

export default router;
