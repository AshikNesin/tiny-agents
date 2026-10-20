/**
 * Browser live-view and takeover routes (issue #24). All JWT-protected,
 * mounted under /api/v1/bots/:id/browser.
 *
 - `GET /live` is MJPEG over a streaming response: the client is a plain
 *   <img>, authorized by the same JWT cookie the app already uses for
 *   uploads. Compression is skipped (text/event-stream filter).
 * - `POST /input` injects mouse/key events through the same CDP channel the
 *   agent uses. Secret keystrokes typed during takeover go straight into the
 *   page and are never logged or persisted.
 */
import type { Request, Response } from "express";
import { z } from "zod";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import {
  closeBrowserSession,
  browserProfilesDir,
  getLiveBrowserSession,
  setDriver,
  type BrowserInput,
} from "@tiny-agents/agent";
import * as botsService from "./bots.service";

const router = createRouter();

const inputSchema = z.union([
  z.object({
    kind: z.literal("mouse"),
    x: z.number().min(0).max(4000),
    y: z.number().min(0).max(4000),
  }),
  z.object({
    kind: z.literal("scroll"),
    x: z.number().min(0).max(4000),
    y: z.number().min(0).max(4000),
    deltaY: z.number().min(-10000).max(10000),
  }),
  z.object({
    kind: z.literal("key"),
    key: z.string().min(1).max(32),
    text: z.string().max(64).optional(),
  }),
]);

const driverSchema = z.object({ driver: z.enum(["agent", "human"]) });

async function botConversation(id: string): Promise<number> {
  const bot = await botsService.getBot(id);
  return Number(bot.conversationId);
}

function requireSession(conversationId: number) {
  const live = getLiveBrowserSession(conversationId);
  if (!live) throw Boom.notFound("No browser session for this bot yet.");
  return live;
}

// Status and live are both exact paths.
router.get("/bots/:id/browser", async (req) => {
  const id = parseStringParam(req.params.id, "id");
  const conversationId = await botConversation(id);
  const live = getLiveBrowserSession(conversationId);
  return {
    active: Boolean(live),
    url: live?.session.url() ?? null,
    driver: live?.driver ?? null,
  };
});

router.get("/bots/:id/browser/live", async (req: Request, res: Response) => {
  const id = parseStringParam(req.params.id, "id");
  const conversationId = await botConversation(id);
  const live = requireSession(conversationId);

  // SSE, not MJPEG: multipart/x-mixed-replace in an <img> does not survive
  // reverse proxies (Cloudflare in front of the deploy buffers or reshapes
  // it, leaving the panel black), while text/event-stream streams through
  // the whole chain — the chat feed already proves that path. Frames are
  // base64 JPEGs; the client paints them into the <img> as blob URLs.
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  // Back-pressure: keep only the newest frame. A stale frame is worthless;
  // the viewer just wants the latest.
  let pending: Buffer | undefined;
  let writing = false;
  const flush = async () => {
    if (writing || !pending || res.destroyed) return;
    writing = true;
    const frame = pending;
    pending = undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        res.write(`event: frame\ndata: ${JSON.stringify({ jpeg: frame.toString("base64") })}\n\n`);
        res.write("", (error) => (error ? reject(error) : resolve()));
      });
    } catch {
      // client gone
    } finally {
      writing = false;
    }
  };

  const off = live.session.on({
    frame: (f: { jpeg: Buffer }) => {
      pending = f.jpeg;
      void flush();
    },
    closed: () => res.end(),
  });
  await startScreencastShared(conversationId, live.session);
  res.on("close", () => {
    off();
    void stopScreencastShared(conversationId, live.session);
  });
  return undefined;
});

// Screencast is session-wide; several viewers may watch one session. Only
// the last disconnect stops it (cubic: one viewer closing froze the rest).
const screencastViewers = new Map<number, number>();
async function startScreencastShared(
  conversationId: number,
  session: { startScreencast(): Promise<void> },
) {
  const n = (screencastViewers.get(conversationId) ?? 0) + 1;
  screencastViewers.set(conversationId, n);
  if (n === 1) await session.startScreencast();
}
async function stopScreencastShared(
  conversationId: number,
  session: { stopScreencast(): Promise<void> },
) {
  const n = (screencastViewers.get(conversationId) ?? 1) - 1;
  if (n <= 0) {
    screencastViewers.delete(conversationId);
    await session.stopScreencast();
  } else {
    screencastViewers.set(conversationId, n);
  }
}

router.post("/bots/:id/browser/input", async (req) => {
  const id = parseStringParam(req.params.id, "id");
  const body = await parseBody(req, inputSchema);
  const conversationId = await botConversation(id);
  const live = requireSession(conversationId);
  // Human input is allowed in either driver mode (pair browsing); the agent
  // absorbs whatever changed at its next snapshot.
  await live.session.input(body as BrowserInput);
  live.lastActivity = Date.now();
  return { ok: true };
});

router.post("/bots/:id/browser/driver", async (req) => {
  const id = parseStringParam(req.params.id, "id");
  const body = await parseBody(req, driverSchema);
  const conversationId = await botConversation(id);
  requireSession(conversationId);
  setDriver(conversationId, body.driver);
  if (body.driver === "human") {
    const live = getLiveBrowserSession(conversationId);
    live!.lastActivity = Date.now();
  }
  return { driver: body.driver };
});

router.delete("/bots/:id/browser/profile", async (req) => {
  const id = parseStringParam(req.params.id, "id");
  const conversationId = await botConversation(id);
  await closeBrowserSession(conversationId);
  const { rmSync } = await import("node:fs");
  rmSync(`${browserProfilesDir()}/${conversationId}`, { recursive: true, force: true });
  return { reset: true };
});

export default router;
