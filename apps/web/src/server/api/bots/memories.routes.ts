import { Hono } from "hono";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import * as memoriesService from "./memories.service";
import { createMemorySchema, listMemoriesSchema, updateMemorySchema } from "./memories.schema";
import type { MemoryList, MemoryResult } from "../../../shared/api/memories";

const router = new Hono<AppEnv>();

router.get("/bots/:id/memories", async (c) => {
  const { includeArchived } = parseQuery(c, listMemoriesSchema);
  return ok<MemoryList>(c, {
    memories: await memoriesService.list(
      parseStringParam(c.req.param("id"), "id"),
      includeArchived,
    ),
  });
});

router.post("/bots/:id/memories", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, createMemorySchema);
  return ok<MemoryResult>(c, { memory: await memoriesService.create(id, payload) }, 201);
});

router.patch("/memories/:id", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, updateMemorySchema);
  return ok<MemoryResult>(c, { memory: await memoriesService.update(id, payload) });
});

router.delete("/memories/:id", async (c) => {
  return ok(c, await memoriesService.remove(parseStringParam(c.req.param("id"), "id")));
});

export default router;
