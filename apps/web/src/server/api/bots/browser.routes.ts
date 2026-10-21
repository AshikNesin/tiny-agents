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
 */
import { z } from "zod";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import {
  browserOpenState,
  closeBrowserSession,
  browserProfilesDir,
  getLiveBrowserSession,
  setDriver,
  startBrowserSession,
} from "@tiny-agents/agent";
import * as botsService from "./bots.service";
import { issueVncTicket } from "./browser.vnc";

const router = createRouter();

const driverSchema = z.object({ driver: z.enum(["agent", "human"]) });

// Floor matches what Chrome renders usefully; the ceiling bounds a hostile
// client, not a real screen.
const resizeSchema = z.object({
  width: z.number().int().min(320).max(4096),
  height: z.number().int().min(240).max(4096),
});

async function botConversation(id: string): Promise<number> {
  const bot = await botsService.getBot(id);
  return Number(bot.conversationId);
}

function requireSession(conversationId: number) {
  const live = getLiveBrowserSession(conversationId);
  if (!live) throw Boom.notFound("No browser session for this bot yet.");
  return live;
}

router.get("/bots/:id/browser", async (req) => {
  const id = parseStringParam(req.params.id, "id");
  const conversationId = await botConversation(id);
  const live = getLiveBrowserSession(conversationId);
  const opening = browserOpenState(conversationId);
  return {
    active: Boolean(live),
    url: live?.session.url() ?? null,
    driver: live?.driver ?? null,
    mode: live ? (live.session.vnc ? "vnc" : "headless") : null,
    scale: live?.session.vnc?.scale ?? null,
    // `phase` is `installing` during the one-time VM setup, else `starting`.
    starting: opening.opening,
    phase: opening.opening ? opening.phase : null,
    error: !live && !opening.opening ? (opening.error ?? null) : null,
  };
});

// Open the browser without a tool call. The first run on a fresh VM installs
// Chrome and TigerVNC (minutes), so this returns at once and the client
// follows the status route.
router.post("/bots/:id/browser/start", async (req) => {
  const id = parseStringParam(req.params.id, "id");
  const conversationId = await botConversation(id);
  if (!getLiveBrowserSession(conversationId)) {
    startBrowserSession(conversationId).catch(() => {
      // The failure is reported by the status route (`error`).
    });
  }
  return { starting: true };
});

router.post("/bots/:id/browser/vnc-ticket", async (req) => {
  const id = parseStringParam(req.params.id, "id");
  const conversationId = await botConversation(id);
  const live = requireSession(conversationId);
  if (!live.session.vnc) {
    throw Boom.conflict("This browser is headless and has no live view.");
  }
  const ticket = issueVncTicket({
    userId: req.user!.userId,
    botId: id,
    conversationId,
  });
  live.lastActivity = Date.now();
  return {
    // Relative so the client keeps the page's scheme and host behind proxies.
    path: `/api/v1/bots/${encodeURIComponent(id)}/browser/vnc?ticket=${ticket}`,
    scale: live.session.vnc.scale,
  };
});

router.post("/bots/:id/browser/resize", async (req) => {
  const id = parseStringParam(req.params.id, "id");
  const body = await parseBody(req, resizeSchema);
  const conversationId = await botConversation(id);
  const live = requireSession(conversationId);
  if (!live.session.vnc) throw Boom.conflict("This browser cannot be resized.");
  await live.session.vnc.resize(body.width, body.height);
  live.lastActivity = Date.now();
  return { width: body.width, height: body.height };
});

router.post("/bots/:id/browser/driver", async (req) => {
  const id = parseStringParam(req.params.id, "id");
  const body = await parseBody(req, driverSchema);
  const conversationId = await botConversation(id);
  requireSession(conversationId);
  await setDriver(conversationId, body.driver);
  if (body.driver === "human") {
    const live = getLiveBrowserSession(conversationId);
    live!.lastActivity = Date.now();
  }
  return { driver: body.driver };
});

router.delete("/bots/:id/browser/profile", async (req) => {
  const id = parseStringParam(req.params.id, "id");
  const conversationId = await botConversation(id);
  await closeBrowserSession(conversationId, { wipeProfile: true });
  const { rmSync } = await import("node:fs");
  rmSync(`${browserProfilesDir()}/${conversationId}`, { recursive: true, force: true });
  return { reset: true };
});

export default router;
