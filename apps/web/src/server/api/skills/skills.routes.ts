import { routes } from "../routes";
import { ok } from "@groot/core/utils/api-response.utils";
import type { Deleted } from "../../../shared/api/common";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import * as skillsService from "./skills.service";
import { createSkillSchema, previewSkillSchema, updateSkillSchema } from "./skills.schema";

const router = routes();

router.get("/skills", async (c) => ok(c, await skillsService.list()));

router.post("/skills/preview", "signedIn", async (c) => {
  return ok(c, await skillsService.preview(await parseBody(c, previewSkillSchema)));
});

router.post("/skills", "signedIn", async (c) => {
  const payload = await parseBody(c, createSkillSchema);
  return ok(c, await skillsService.create(payload), 201);
});

router.get("/skills/:id", async (c) => {
  return ok(c, await skillsService.get(parseStringParam(c.req.param("id"), "id")));
});

router.patch("/skills/:id", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  return ok(c, await skillsService.update(id, await parseBody(c, updateSkillSchema)));
});

router.delete("/skills/:id", "signedIn", async (c) => {
  await skillsService.remove(parseStringParam(c.req.param("id"), "id"));
  return ok<Deleted>(c, { deleted: true });
});

export default router.hono;
