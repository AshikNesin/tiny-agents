import type { Request } from "express";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseStringParam, parseBody } from "@groot/core/utils/controller.utils";
import * as appSettingsService from "./app-settings.service";
import { upsertAppSettingSchema } from "./app-settings.schema";

const router = createRouter();

router.get("/", async () => {
  return await appSettingsService.getAll();
});

router.get("/:key", async (req: Request) => {
  const key = parseStringParam(req.params.key, "key");
  return await appSettingsService.get({ key });
});

// Writes are session-authorized (this router mounts behind jwtAuthMiddleware).
// The settings UI is a first-party feature — every signed-in user manages
// settings in-app. The admin key stays reserved for machine endpoints like
// POST/GET /auth/users.
router.put("/:key", async (req: Request) => {
  const key = parseStringParam(req.params.key, "key");
  const payload = parseBody(req, upsertAppSettingSchema);
  return await appSettingsService.upsert({ key, data: payload });
});

router.delete("/:key", async (req: Request) => {
  const key = parseStringParam(req.params.key, "key");
  return await appSettingsService.deleteSetting({ key });
});

export default router;
