import type { Request, Response } from "express";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseBody, parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import * as routinesService from "./routines.service";
import { createRoutineSchema, listRunsSchema, updateRoutineSchema } from "./routines.schema";
import { formatIst, safeParseSchedule } from "./routines.schedule";

const router = createRouter();

router.get("/routines", async () => routinesService.list());

router.post("/routines", async (req: Request, res: Response) => {
  const payload = parseBody(req, createRoutineSchema);
  res.status(201);
  const routine = await routinesService.create(payload);
  return { ...routine, nextFireTimes: fireTimesOf(routine.schedule) };
});

router.get("/routines/runs/recent", async (req: Request) => {
  const { limit } = parseQuery(req, listRunsSchema);
  return { runs: await routinesService.recentRuns(limit) };
});

router.get("/routines/:id", async (req: Request) =>
  routinesService.get(parseStringParam(req.params.id, "id")),
);

router.patch("/routines/:id", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const payload = parseBody(req, updateRoutineSchema);
  const routine = await routinesService.update(id, payload);
  return { ...routine, nextFireTimes: fireTimesOf(routine.schedule) };
});

router.delete("/routines/:id", async (req: Request) => {
  await routinesService.remove(parseStringParam(req.params.id, "id"));
  return { deleted: true };
});

router.post("/routines/:id/pause", async (req: Request) => {
  return routinesService.pause(parseStringParam(req.params.id, "id"));
});

router.post("/routines/:id/resume", async (req: Request) => {
  return routinesService.resume(parseStringParam(req.params.id, "id"));
});

router.post("/routines/:id/run", async (req: Request) => {
  return routinesService.runNow(parseStringParam(req.params.id, "id"));
});

router.get("/routines/:id/runs", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const { limit } = parseQuery(req, listRunsSchema);
  return { runs: await routinesService.listRuns(id, limit) };
});

function fireTimesOf(schedule: unknown): string[] {
  const parsed = safeParseSchedule(schedule);
  if (!parsed) return [];
  return routinesService.previewFireTimes(parsed, new Date()).map((time) => formatIst(time));
}

export default router;
