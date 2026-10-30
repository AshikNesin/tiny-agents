import { Hono } from "hono";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import * as skillsService from "./skills.service";
import { createSkillSchema, previewSkillSchema, updateSkillSchema } from "./skills.schema";

const router = new Hono<AppEnv>();

router.get("/skills", async (c) => ok(c, await skillsService.list()));

router.post("/skills/preview", async (c) => {
  return ok(c, await skillsService.preview(await parseBody(c, previewSkillSchema)));
});

router.post("/skills", async (c) => {
  const payload = await parseBody(c, createSkillSchema);
  return ok(c, await skillsService.create(payload), 201);
});

router.get("/skills/:id", async (c) => {
  return ok(c, await skillsService.get(parseStringParam(c.req.param("id"), "id")));
});

router.patch("/skills/:id", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  return ok(c, await skillsService.update(id, await parseBody(c, updateSkillSchema)));
});

router.delete("/skills/:id", async (c) => {
  await skillsService.remove(parseStringParam(c.req.param("id"), "id"));
  return ok(c, { deleted: true });
});

export default router;
