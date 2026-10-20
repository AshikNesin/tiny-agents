/**
 * Browser live-view and takeover routes (issue #24). All JWT-protected,
 * mounted under /api/v1/bots/:id/browser.
 *
 - `GET /live` is MJPEG over a streaming response: the client is a plain
 *   <img>, authorized by the same JWT cookie the app already uses for
 *   uploads. Compression is skipped (multipart/x-mixed-replace filter).
 * - `POST /input` injects mouse/key events through the same CDP channel the
 *   agent uses. Secret keystrokes typed during takeover go straight into the
 *   page and are never logged or persisted.
 */
import type { Request, Response } from "express";
import { z } from "zod";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import { getLiveBrowserSession, setDriver, type BrowserInput } from "@tiny-agents/agent";
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

// Status must sit before the MJPEG route only in name; both are exact paths.
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

  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  // Back-pressure: keep only the newest frame. A stale frame is worthless;
  // the img element just wants the latest.
  let pending: Buffer | undefined;
  let writing = false;
  const flush = async () => {
    if (writing || !pending || res.destroyed) return;
    writing = true;
    const frame = pending;
    pending = undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
        res.write(frame, (error) => (error ? reject(error) : resolve()));
      });
      res.write("\r\n");
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
  await live.session.startScreencast();
  res.on("close", () => {
    off();
    void live.session.stopScreencast();
  });
  return undefined;
});

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
  const live = getLiveBrowserSession(conversationId);
  if (live) {
    setDriver(conversationId, "agent");
    await live.session.close();
  }
  const { rmSync } = await import("node:fs");
  rmSync(`./data/browser-profiles/${conversationId}`, { recursive: true, force: true });
  return { reset: true };
});

export default router;
