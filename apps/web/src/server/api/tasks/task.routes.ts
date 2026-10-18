import type { Request } from "express";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import * as taskService from "./task.service";
import { createTaskSchema, updateTaskSchema } from "./task.schema";

const router = createRouter();

router.get("/tasks", async () => taskService.list());

router.post("/tasks", async (req: Request) => {
  const payload = parseBody(req, createTaskSchema);
  return taskService.create(payload);
});

router.patch("/tasks/:id", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const payload = parseBody(req, updateTaskSchema);
  return taskService.update(id, payload);
});

router.delete("/tasks/:id", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  await taskService.remove(id);
  return { deleted: true };
});

export default router;
