/**
 * Notification settings API (mounted at /notifications behind JWT auth):
 * channel status, the owner's preferences, a test send, re-validation and
 * the recent log (metadata only).
 */
import type { Request } from "express";
import { z } from "zod";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseQuery } from "@groot/core/utils/controller.utils";
import { notificationService } from "./notification.service";

const router = createRouter();

const logQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

router.get("/status", async () => notificationService.status());

router.get("/settings", async () => ({
  settings: await notificationService.getSettings(),
  events: notificationService.events(),
}));

router.put("/settings", async (req: Request) => ({
  settings: await notificationService.saveSettings(req.body),
  events: notificationService.events(),
}));

router.post("/test", async () => notificationService.sendTest());

router.post("/validate", async () => notificationService.validate());

router.get("/log", async (req: Request) => {
  const { limit } = parseQuery(req, logQuerySchema);
  return notificationService.recent(limit);
});

export default router;
