/**
 * Computer live-view and takeover routes (issue #108). All JWT-protected,
 * mounted under /api/v1/bots/:id/computer.
 *
 * The computer is an XFCE desktop on the sandbox VM, one per browser profile
 * (bots on the shared profile share it). `POST /vnc-ticket` mints the
 * one-time ticket for the WebSocket in `computer.vnc.ts`; the desktop has a
 * fixed size, so unlike the browser there is no resize route: the viewer
 * scales it. Keystrokes travel inside the VNC stream and are never logged.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseStringParam, requireUser } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import type { ComputerSessions } from "@tiny-agents/agent";
import * as botsService from "./bots.service";
import { SHARED_BROWSER_PROFILE } from "./browser.targets";
import { computerProfileForBot, computerSetupHint, getComputerSessions } from "./computer.sessions";
import { issueComputerVncTicket } from "./computer.vnc";

const router = new Hono<AppEnv>();

const driverSchema = z.object({ driver: z.enum(["agent", "human"]) });

async function botProfile(id: string): Promise<string> {
  return computerProfileForBot(await botsService.getBot(id));
}

function requireSessions(): ComputerSessions {
  const sessions = getComputerSessions();
  if (!sessions) throw Boom.conflict(computerSetupHint() ?? "The computer is not configured.");
  return sessions;
}

router.get("/bots/:id/computer", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const profile = await botProfile(id);
  const sessions = getComputerSessions();
  if (!sessions) {
    return ok(c, {
      configured: false,
      setupHint: computerSetupHint() ?? null,
      active: false,
      profile: profile === SHARED_BROWSER_PROFILE ? "shared" : "own",
      driver: null,
      width: null,
      height: null,
      takeover: null,
      starting: false,
      phase: null,
      error: null,
    });
  }
  const live = sessions.get(profile);
  const opening = sessions.openState(profile);
  return ok(c, {
    configured: true,
    setupHint: null,
    active: Boolean(live),
    // "shared" when other bots use this desktop too.
    profile: profile === SHARED_BROWSER_PROFILE ? "shared" : "own",
    driver: live?.driver ?? null,
    width: sessions.width,
    height: sessions.height,
    // What a bot asked the owner to do (computer_request_takeover), while it waits.
    takeover: live?.takeover?.reason ?? null,
    // `phase` is `installing` during the one-time VM setup, else `starting`.
    starting: opening.opening,
    phase: opening.opening ? opening.phase : null,
    error: !live && !opening.opening ? (opening.error ?? null) : null,
  });
});

// Open the desktop without a tool call. The first run on a fresh VM installs
// XFCE and the X11 tools (minutes), so this returns at once and the client
// follows the status route.
router.post("/bots/:id/computer/start", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const profile = await botProfile(id);
  requireSessions()
    .start(profile)
    .catch(() => {
      // The failure is reported by the status route (`error`).
    });
  return ok(c, { starting: true });
});

router.post("/bots/:id/computer/vnc-ticket", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const profile = await botProfile(id);
  const live = requireSessions().get(profile);
  if (!live?.desktop.vnc) throw Boom.notFound("No desktop is running for this bot yet.");
  const ticket = issueComputerVncTicket({ userId: requireUser(c).userId, botId: id, profile });
  live.lastActivity = Date.now();
  return ok(c, {
    // Relative so the client keeps the page's scheme and host behind proxies.
    path: `/api/v1/bots/${encodeURIComponent(id)}/computer/vnc?ticket=${ticket}`,
    scale: 1,
  });
});

router.post("/bots/:id/computer/driver", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const body = await parseBody(c, driverSchema);
  const profile = await botProfile(id);
  const sessions = requireSessions();
  if (!sessions.get(profile)) throw Boom.notFound("No desktop is running for this bot yet.");
  // Handing back also answers a bot's takeover request.
  await sessions.setDriver(profile, body.driver);
  return ok(c, { driver: body.driver });
});

// Reset: close the desktop and wipe its settings and app state on the VM.
// Files in the home directory are untouched. On the shared profile this
// resets the desktop every bot on it uses.
router.delete("/bots/:id/computer/profile", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const profile = await botProfile(id);
  const sessions = requireSessions();
  try {
    await sessions.close(profile, { wipe: true });
  } catch (error) {
    throw Boom.badGateway(error instanceof Error ? error.message : "Could not reset the computer.");
  }
  return ok(c, { reset: true });
});

export default router;
