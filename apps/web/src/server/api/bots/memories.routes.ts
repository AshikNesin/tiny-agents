import type { Request, Response } from "express";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseBody, parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import * as memoriesService from "./memories.service";
import { createMemorySchema, listMemoriesSchema, updateMemorySchema } from "./memories.schema";

const router = createRouter();

router.get("/bots/:id/memories", async (req: Request) => {
  const { includeArchived } = parseQuery(req, listMemoriesSchema);
  return {
    memories: await memoriesService.list(parseStringParam(req.params.id, "id"), includeArchived),
  };
});

router.post("/bots/:id/memories", async (req: Request, res: Response) => {
  const id = parseStringParam(req.params.id, "id");
  const payload = parseBody(req, createMemorySchema);
  res.status(201);
  return { memory: await memoriesService.create(id, payload) };
});

router.patch("/memories/:id", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const payload = parseBody(req, updateMemorySchema);
  return { memory: await memoriesService.update(id, payload) };
});

router.delete("/memories/:id", async (req: Request) => {
  return memoriesService.remove(parseStringParam(req.params.id, "id"));
});

export default router;
