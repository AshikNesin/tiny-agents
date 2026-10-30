/**
 * Notification settings API (mounted at /notifications behind JWT auth):
 * channel status, the owner's preferences, a test send, re-validation and
 * the recent log (metadata only).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext, AppEnv } from "@groot/core/types";
import { Boom, ErrorCode } from "@groot/core/errors";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseQuery } from "@groot/core/utils/controller.utils";
import { notificationService } from "./notification.service";

const router = new Hono<AppEnv>();

const logQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * The raw JSON body, validated by the service itself (its 400 names the
 * settings). No body reads as `undefined`, like Express's `req.body`.
 */
async function jsonBody(c: AppContext): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim() === "") return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw Boom.badRequest("Invalid JSON body", undefined, ErrorCode.VALIDATION_ERROR.code);
  }
}

router.get("/status", (c) => ok(c, notificationService.status()));

router.get("/settings", async (c) =>
  ok(c, {
    settings: await notificationService.getSettings(),
    events: notificationService.events(),
  }),
);

router.put("/settings", async (c) =>
  ok(c, {
    settings: await notificationService.saveSettings(await jsonBody(c)),
    events: notificationService.events(),
  }),
);

router.post("/test", async (c) => ok(c, await notificationService.sendTest()));

router.post("/validate", async (c) => ok(c, await notificationService.validate()));

router.get("/log", async (c) => {
  const { limit } = parseQuery(c, logQuerySchema);
  return ok(c, await notificationService.recent(limit));
});

export default router;
