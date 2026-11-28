import { z } from "zod";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import type { AppContext } from "@groot/core/types";
import { Boom } from "@groot/core/errors";
import { routes } from "../routes";
import { artifactDetail, artifactVersion, restoreArtifact } from "./artifacts.service";
import { artifactFrameResponse } from "./artifacts.frame";

const router = routes();

const restoreSchema = z.object({ seq: z.number().int().min(1) });

function params(c: AppContext) {
  return {
    botId: parseStringParam(c.req.param("id"), "id"),
    artifactId: parseStringParam(c.req.param("artifactId"), "artifactId"),
  };
}

function parseSeq(raw: string | undefined): number {
  const seq = Number(raw);
  if (!Number.isInteger(seq) || seq < 1) throw Boom.badRequest("Invalid version");
  return seq;
}

router.get("/bots/:id/artifacts/:artifactId", (c) => {
  const { botId, artifactId } = params(c);
  return ok(c, artifactDetail(botId, artifactId));
});

router.get("/bots/:id/artifacts/:artifactId/versions/:seq", (c) => {
  const { botId, artifactId } = params(c);
  return ok(c, artifactVersion(botId, artifactId, parseSeq(c.req.param("seq"))));
});

router.post("/bots/:id/artifacts/:artifactId/restore", "signedIn", async (c) => {
  const { botId, artifactId } = params(c);
  const { seq } = await parseBody(c, restoreSchema);
  return ok(c, restoreArtifact(botId, artifactId, seq));
});

export default router.hono;

const frame = routes();

frame.get("/artifact-frame", () => artifactFrameResponse());

export const artifactFrameRouter = frame.hono;
