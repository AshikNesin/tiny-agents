import type { Request, Response } from "express";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import * as skillsService from "./skills.service";
import { createSkillSchema, previewSkillSchema, updateSkillSchema } from "./skills.schema";

const router = createRouter();

router.get("/skills", async () => skillsService.list());

router.post("/skills/preview", async (req: Request) => {
  return skillsService.preview(parseBody(req, previewSkillSchema));
});

router.post("/skills", async (req: Request, res: Response) => {
  const payload = parseBody(req, createSkillSchema);
  res.status(201);
  return skillsService.create(payload);
});

router.get("/skills/:id", async (req: Request) => {
  return skillsService.get(parseStringParam(req.params.id, "id"));
});

router.patch("/skills/:id", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  return skillsService.update(id, parseBody(req, updateSkillSchema));
});

router.delete("/skills/:id", async (req: Request) => {
  await skillsService.remove(parseStringParam(req.params.id, "id"));
  return { deleted: true };
});

export default router;
