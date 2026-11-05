/**
 * The Browser page's routes (issue #160): the bots' browsers by profile
 * rather than by bot, so the owner can open and use any of them directly
 * (the way the Computer page reaches the desktops). All JWT-protected and
 * owner-only (the guest guard lists none of them), mounted under
 * /api/v1/browser.
 *
 * A browser is a profile's: `shared` (every bot on the shared profile) and
 * `bot-<id>` for each bot with a profile of its own (`profiles.ts`).
 *
 * The owner gets a tab of their own in it, keyed `owner`: opening the page
 * never lands in a bot's tab, and handing control back from the page leaves
 * every bot's tab as it was (a hand-back moves only the releasing tab's
 * holder to the tab in front, and no bot holds `owner`). Driving is the same
 * driver flag as the chat's Browser panel, so the bots on that browser wait
 * while the owner drives.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, requireUser } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import type { BrowserTarget } from "@tiny-agents/agent";
import { browserLiveViewHint, getBrowserSessions } from "./browser.sessions";
import { issueBrowserPageVncTicket } from "./browser.vnc";
import { knownProfile, listProfiles } from "./profiles";

/** The owner's tab in every browser; bot tabs are keyed by bot id. */
export const OWNER_TAB = "owner";

const router = new Hono<AppEnv>();

const driverSchema = z.object({ driver: z.enum(["agent", "human"]) });

// Same bounds as the chat panel's resize route.
const resizeSchema = z.object({
  width: z.number().int().min(320).max(4096),
  height: z.number().int().min(240).max(4096),
});

/** The owner's target in the browser a path names (`shared` or an own-profile bot's), else 404. */
async function ownerTarget(raw: string | undefined): Promise<BrowserTarget> {
  return { profile: await knownProfile(raw, "No such browser."), tab: OWNER_TAB };
}

function requireLive(target: BrowserTarget) {
  const live = getBrowserSessions().get(target);
  if (!live) throw Boom.notFound("This browser is not running.");
  return live;
}

router.get("/browser", async (c) => {
  const sessions = getBrowserSessions();
  const hint = browserLiveViewHint();
  const list = await listProfiles();
  return ok(c, {
    liveView: !hint,
    setupHint: hint ?? null,
    browsers: list.map((entry) => {
      const target = { profile: entry.profile, tab: OWNER_TAB };
      const live = sessions.get(target);
      const opening = sessions.openState(target);
      return {
        ...entry,
        active: Boolean(live),
        driver: live?.driver ?? null,
        mode: live ? (live.session.vnc ? "vnc" : "headless") : null,
        starting: opening.opening,
        phase: opening.opening ? opening.phase : null,
        error: !live && !opening.opening ? (opening.error ?? null) : null,
      };
    }),
  });
});

// Opens the browser (if needed) and the owner's tab, in front. The first run
// on a fresh VM installs Chrome (minutes), so this returns at once and the
// page follows the list route.
router.post("/browser/:profile/start", async (c) => {
  const target = await ownerTarget(c.req.param("profile"));
  getBrowserSessions()
    .start(target)
    .catch(() => {
      // Reported by the list route (`error`).
    });
  return ok(c, { starting: true });
});

router.post("/browser/:profile/vnc-ticket", async (c) => {
  const target = await ownerTarget(c.req.param("profile"));
  const live = requireLive(target);
  if (!live.session.vnc) throw Boom.conflict("This browser is headless and has no live view.");
  const ticket = issueBrowserPageVncTicket({
    userId: requireUser(c).userId,
    profile: target.profile,
    target,
  });
  live.lastActivity = Date.now();
  return ok(c, {
    // Relative so the client keeps the page's scheme and host behind proxies.
    path: `/api/v1/browser/${encodeURIComponent(target.profile)}/vnc?ticket=${ticket}`,
    scale: live.session.vnc.scale,
  });
});

// One Chrome window per profile: the page and a chat panel both fit it to
// their view, and the last to connect or resize wins.
router.post("/browser/:profile/resize", async (c) => {
  const [target, body] = await Promise.all([
    ownerTarget(c.req.param("profile")),
    parseBody(c, resizeSchema),
  ]);
  const live = requireLive(target);
  if (!live.session.vnc) throw Boom.conflict("This browser cannot be resized.");
  try {
    await live.session.vnc.resize(body.width, body.height);
  } catch (error) {
    throw Boom.badGateway(error instanceof Error ? error.message : "Could not resize the browser.");
  }
  live.lastActivity = Date.now();
  return ok(c, { width: body.width, height: body.height });
});

router.post("/browser/:profile/driver", async (c) => {
  const [target, body] = await Promise.all([
    ownerTarget(c.req.param("profile")),
    parseBody(c, driverSchema),
  ]);
  const live = requireLive(target);
  await getBrowserSessions().setDriver(target, body.driver);
  if (body.driver === "human") live.lastActivity = Date.now();
  return ok(c, { driver: body.driver });
});

// Reset: close the browser and wipe its profile (cookies, logins). On the
// shared profile this signs every bot that uses it out.
router.delete("/browser/:profile", async (c) => {
  const target = await ownerTarget(c.req.param("profile"));
  const sessions = getBrowserSessions();
  await sessions.close(target, { wipeProfile: true });
  const { rmSync } = await import("node:fs");
  rmSync(`${sessions.profilesDir}/${target.profile}`, { recursive: true, force: true });
  return ok(c, { reset: true });
});

export default router;
