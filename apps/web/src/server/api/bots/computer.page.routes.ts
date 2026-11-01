/**
 * The Computer page's routes: the desktops on the sandbox VM, by profile
 * rather than by bot, so the owner can open and drive any of them directly
 * (the way the Terminal page reaches the VM's shells). All JWT-protected,
 * mounted under /api/v1/computer.
 *
 * A desktop is a browser profile's: `shared` (every bot on the shared
 * profile) and `bot-<id>` for each bot with a profile of its own. Only those
 * profiles are accepted, so the page cannot start a desktop nobody owns.
 *
 * Driving is the same driver flag as the chat's Computer panel: taking
 * control pauses the bots on that desktop and stops their screenshots, and
 * handing back answers a bot's takeover request. Opening an app from the
 * page is an owner action, so it needs the owner to be driving.
 */
import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseStringParam, requireUser } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import type { ComputerSessions } from "@tiny-agents/agent";
import { db, bots } from "../../db";
import { SHARED_BROWSER_PROFILE } from "./browser.targets";
import { computerSetupHint, getComputerSessions } from "./computer.sessions";
import { issueDesktopVncTicket } from "./computer.vnc";

const router = new Hono<AppEnv>();

const driverSchema = z.object({ driver: z.enum(["agent", "human"]) });
const openAppSchema = z.object({ id: z.string().min(1).max(128) });

/** One desktop the page lists: who uses it and how it stands. */
interface DesktopEntry {
  profile: string;
  /** "Shared", or the bot's name. */
  label: string;
  /** Bots that use this desktop. */
  bots: { id: string; name: string }[];
}

/** Every desktop a bot can have: the shared one, and one per own-profile bot. */
async function desktops(): Promise<DesktopEntry[]> {
  const rows = await db
    .select({ id: bots.id, name: bots.name, browserProfile: bots.browserProfile })
    .from(bots)
    .orderBy(asc(bots.name));
  const shared = rows.filter((row) => row.browserProfile !== "own");
  return [
    {
      profile: SHARED_BROWSER_PROFILE,
      label: "Shared",
      bots: shared.map(({ id, name }) => ({ id, name })),
    },
    ...rows
      .filter((row) => row.browserProfile === "own")
      .map((row) => ({
        profile: `bot-${row.id}`,
        label: row.name,
        bots: [{ id: row.id, name: row.name }],
      })),
  ];
}

/** The profile in the path, if it names a desktop a bot can have. */
async function knownProfile(raw: string | undefined): Promise<string> {
  const profile = parseStringParam(raw, "profile");
  if (profile === SHARED_BROWSER_PROFILE) return profile;
  const id = /^bot-(.+)$/.exec(profile)?.[1];
  if (id) {
    const [row] = await db
      .select({ browserProfile: bots.browserProfile })
      .from(bots)
      .where(eq(bots.id, id))
      .limit(1);
    if (row?.browserProfile === "own") return profile;
  }
  throw Boom.notFound("No such desktop.");
}

function requireSessions(): ComputerSessions {
  const sessions = getComputerSessions();
  if (!sessions) throw Boom.conflict(computerSetupHint() ?? "The computer is not configured.");
  return sessions;
}

function requireLive(sessions: ComputerSessions, profile: string) {
  const live = sessions.get(profile);
  if (!live) throw Boom.notFound("This desktop is not running.");
  return live;
}

router.get("/computer", async (c) => {
  const sessions = getComputerSessions();
  const list = await desktops();
  return ok(c, {
    configured: Boolean(sessions),
    setupHint: sessions ? null : (computerSetupHint() ?? null),
    width: sessions?.width ?? null,
    height: sessions?.height ?? null,
    desktops: list.map((desktop) => {
      const live = sessions?.get(desktop.profile);
      const opening = sessions?.openState(desktop.profile) ?? { opening: false as const };
      return {
        ...desktop,
        active: Boolean(live),
        driver: live?.driver ?? null,
        takeover: live?.takeover?.reason ?? null,
        starting: opening.opening,
        phase: opening.opening ? opening.phase : null,
        error: !live && !opening.opening ? (opening.error ?? null) : null,
      };
    }),
  });
});

// Starts in the background: the first run installs the desktop (minutes),
// and the page follows the list route.
router.post("/computer/:profile/start", async (c) => {
  const profile = await knownProfile(c.req.param("profile"));
  requireSessions()
    .start(profile)
    .catch(() => {
      // Reported by the list route (`error`).
    });
  return ok(c, { starting: true });
});

router.post("/computer/:profile/vnc-ticket", async (c) => {
  const profile = await knownProfile(c.req.param("profile"));
  const live = requireLive(requireSessions(), profile);
  if (!live.desktop.vnc) throw Boom.conflict("This desktop has no live view.");
  const ticket = issueDesktopVncTicket({ userId: requireUser(c).userId, profile });
  live.lastActivity = Date.now();
  return ok(c, {
    path: `/api/v1/computer/${encodeURIComponent(profile)}/vnc?ticket=${ticket}`,
    scale: 1,
  });
});

router.post("/computer/:profile/driver", async (c) => {
  const [profile, body] = await Promise.all([
    knownProfile(c.req.param("profile")),
    parseBody(c, driverSchema),
  ]);
  const sessions = requireSessions();
  requireLive(sessions, profile);
  await sessions.setDriver(profile, body.driver);
  return ok(c, { driver: body.driver });
});

router.get("/computer/:profile/apps", async (c) => {
  const profile = await knownProfile(c.req.param("profile"));
  const live = requireLive(requireSessions(), profile);
  try {
    return ok(c, { apps: await live.desktop.listApps() });
  } catch (error) {
    throw Boom.badGateway(error instanceof Error ? error.message : "Could not list the apps.");
  }
});

router.post("/computer/:profile/apps", async (c) => {
  const [profile, body] = await Promise.all([
    knownProfile(c.req.param("profile")),
    parseBody(c, openAppSchema),
  ]);
  const live = requireLive(requireSessions(), profile);
  // The owner acts on the desktop only while the bots on it are paused.
  if (live.driver !== "human") throw Boom.conflict("Take control of the desktop first.");
  try {
    await live.desktop.openApp(body.id);
  } catch (error) {
    throw Boom.badGateway(error instanceof Error ? error.message : "Could not open the app.");
  }
  live.lastActivity = Date.now();
  return ok(c, { opened: body.id });
});

// Reset: close the desktop and wipe its settings and app state on the VM.
router.delete("/computer/:profile", async (c) => {
  const profile = await knownProfile(c.req.param("profile"));
  const sessions = requireSessions();
  try {
    await sessions.close(profile, { wipe: true });
  } catch (error) {
    throw Boom.badGateway(error instanceof Error ? error.message : "Could not reset the computer.");
  }
  return ok(c, { reset: true });
});

export default router;
