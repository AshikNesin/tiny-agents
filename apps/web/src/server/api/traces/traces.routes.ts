import { Hono } from "hono";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import * as traces from "./traces.service";
import { listSessionsSchema, listSideCallsSchema } from "./traces.schema";
import type {
  SideCallList,
  TraceSessionDetail,
  TraceSessionList,
  TraceSummary,
} from "../../../shared/api/traces";

const router = new Hono<AppEnv>();

router.get("/traces/summary", async (c) => ok<TraceSummary>(c, await traces.summary()));

router.get("/traces/sessions", async (c) => {
  const { kind, before } = parseQuery(c, listSessionsSchema);
  return ok<TraceSessionList>(
    c,
    await traces.listSessions({
      ...(kind ? { kind } : {}),
      ...(before !== undefined ? { before } : {}),
    }),
  );
});

router.get("/traces/sessions/:id", async (c) =>
  ok<TraceSessionDetail>(c, await traces.getSession(parseStringParam(c.req.param("id"), "id"))),
);

router.get("/traces/side-calls", async (c) => {
  const { before } = parseQuery(c, listSideCallsSchema);
  return ok<SideCallList>(c, await traces.listSideCalls(before !== undefined ? { before } : {}));
});

export default router;
