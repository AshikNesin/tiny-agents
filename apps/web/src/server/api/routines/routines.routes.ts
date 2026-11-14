import { Hono } from "hono";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import type { Deleted } from "../../../shared/api/common";
import { parseBody, parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import * as routinesService from "./routines.service";
import { createRoutineSchema, listRunsSchema, updateRoutineSchema } from "./routines.schema";
import { formatIst, safeParseSchedule } from "./routines.schedule";
import type { RoutineWithPreviewData } from "../../../shared/api/routines";

const router = new Hono<AppEnv>();

router.get("/routines", async (c) => ok(c, await routinesService.list()));

router.post("/routines", async (c) => {
  const payload = await parseBody(c, createRoutineSchema);
  const routine = await routinesService.create(payload);
  return ok<RoutineWithPreviewData>(
    c,
    { ...routine, nextFireTimes: fireTimesOf(routine.schedule) },
    201,
  );
});

router.get("/routines/runs/recent", async (c) => {
  const { limit } = parseQuery(c, listRunsSchema);
  return ok(c, { runs: await routinesService.recentRuns(limit) });
});

router.get("/routines/:id", async (c) =>
  ok(c, await routinesService.get(parseStringParam(c.req.param("id"), "id"))),
);

router.patch("/routines/:id", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, updateRoutineSchema);
  const routine = await routinesService.update(id, payload);
  return ok<RoutineWithPreviewData>(c, {
    ...routine,
    nextFireTimes: fireTimesOf(routine.schedule),
  });
});

router.delete("/routines/:id", async (c) => {
  await routinesService.remove(parseStringParam(c.req.param("id"), "id"));
  return ok<Deleted>(c, { deleted: true });
});

router.post("/routines/:id/pause", async (c) =>
  ok(c, await routinesService.pause(parseStringParam(c.req.param("id"), "id"))),
);

router.post("/routines/:id/resume", async (c) =>
  ok(c, await routinesService.resume(parseStringParam(c.req.param("id"), "id"))),
);

router.post("/routines/:id/run", async (c) =>
  ok(c, await routinesService.runNow(parseStringParam(c.req.param("id"), "id"))),
);

router.get("/routines/:id/runs", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const { limit } = parseQuery(c, listRunsSchema);
  return ok(c, { runs: await routinesService.listRuns(id, limit) });
});

function fireTimesOf(schedule: unknown): string[] {
  const parsed = safeParseSchedule(schedule);
  if (!parsed) return [];
  return routinesService.previewFireTimes(parsed, new Date()).map((time) => formatIst(time));
}

export default router;
