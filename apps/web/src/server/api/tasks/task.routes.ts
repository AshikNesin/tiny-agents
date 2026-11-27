import { routes } from "../routes";
import { ok } from "@groot/core/utils/api-response.utils";
import type { Deleted } from "../../../shared/api/common";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import * as taskService from "./task.service";
import { createTaskSchema, updateTaskSchema } from "./task.schema";

const router = routes();

router.get("/tasks", async (c) => ok(c, await taskService.list()));

router.post("/tasks", "signedIn", async (c) => {
  const payload = await parseBody(c, createTaskSchema);
  return ok(c, await taskService.create(payload));
});

router.patch("/tasks/:id", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, updateTaskSchema);
  return ok(c, await taskService.update(id, payload));
});

router.delete("/tasks/:id", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  await taskService.remove(id);
  return ok<Deleted>(c, { deleted: true });
});

export default router.hono;
