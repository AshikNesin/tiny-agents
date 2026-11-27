import { routes } from "../routes";
import type { AppContext } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import type { Deleted } from "../../../shared/api/common";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import { logger } from "@groot/core/logger";
import { verifySessionToken } from "@groot/core/session";
import { readSessionToken } from "@groot/core/session/cookie";
import { authRateLimiter } from "@groot/core/middlewares/rate-limit.middleware";
import * as connectionsService from "./connections.service";
import { getConnectionManager } from "./connections.manager";
import { clientMetadata, clientMetadataUrl } from "./oauth";
import { assertStepUp } from "../vault/vault.stepup";
import {
  callToolSchema,
  createConnectionSchema,
  testConnectionSchema,
  updateConnectionSchema,
  updateToolSchema,
} from "./connections.schema";

export const publicConnectionsRouter = routes();

publicConnectionsRouter.get("/connections/oauth/client-metadata.json", (c) =>
  c.json({ ...clientMetadata(), client_id: clientMetadataUrl() }),
);

function singleQuery(c: AppContext, name: string): string | undefined {
  const values = c.req.queries(name);
  return values?.length === 1 ? values[0] : undefined;
}

async function callbackViewer(c: AppContext): Promise<number | undefined> {
  const token = readSessionToken(c);
  if (!token) return undefined;
  try {
    return (await verifySessionToken(token)).userId;
  } catch {
    return undefined;
  }
}

publicConnectionsRouter.get("/connections/oauth/callback", authRateLimiter, async (c) => {
  const code = singleQuery(c, "code");
  const state = singleQuery(c, "state");
  const denied = singleQuery(c, "error");
  const viewer = await callbackViewer(c);
  let id: string | undefined;
  let error = denied;
  if (!error && code && state) {
    try {
      id = await getConnectionManager().finishAuthorization(state, code, viewer);
    } catch (cause) {
      logger.warn({ error: cause }, "MCP OAuth callback failed");
      error = cause instanceof Error ? cause.message : "Sign-in failed";
    }
  } else if (!error) {
    error = "Missing code";
  }
  const payload = JSON.stringify({ type: "tiny-agents:oauth", id, error }).replace(/</g, "\\u003c");
  const fallback = id ? `/connections/${encodeURIComponent(id)}` : "/connections";
  return c.html(
    `<!doctype html><meta charset="utf-8"><title>Signed in</title><script>` +
      `if (window.opener) { window.opener.postMessage(${payload}, location.origin); window.close(); }` +
      ` else { location.replace(${JSON.stringify(fallback)}); }` +
      `</script>`,
    200,
  );
});

const router = routes();

router.get("/connections", async (c) => ok(c, await connectionsService.list()));

router.post("/connections/test", "signedIn", async (c) => {
  return ok(c, await connectionsService.test(await parseBody(c, testConnectionSchema)));
});

router.post("/connections", "stepUp", async (c) => {
  const payload = await parseBody(c, createConnectionSchema);
  return ok(c, await connectionsService.create(payload), 201);
});

router.get("/connections/:id", async (c) => {
  return ok(c, await connectionsService.get(parseStringParam(c.req.param("id"), "id")));
});

router.patch("/connections/:id", "stepUpForSome", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, updateConnectionSchema);
  if (payload.url !== undefined || payload.secretRef !== undefined) assertStepUp(c);
  return ok(c, await connectionsService.update(id, payload));
});

router.delete("/connections/:id", "stepUp", async (c) => {
  await connectionsService.remove(parseStringParam(c.req.param("id"), "id"));
  return ok<Deleted>(c, { deleted: true });
});

router.post("/connections/:id/reconnect", "signedIn", async (c) => {
  return ok(c, await connectionsService.reconnect(parseStringParam(c.req.param("id"), "id")));
});

router.post("/connections/:id/authorize", "signedIn", async (c) => {
  const userId = c.get("user")!.userId;
  return ok(
    c,
    await connectionsService.authorize(parseStringParam(c.req.param("id"), "id"), userId),
  );
});

router.get("/connections/:id/tools/:tool", async (c) => {
  return ok(
    c,
    await connectionsService.getTool(
      parseStringParam(c.req.param("id"), "id"),
      parseStringParam(c.req.param("tool"), "tool"),
    ),
  );
});

router.patch("/connections/:id/tools/:tool", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const tool = parseStringParam(c.req.param("tool"), "tool");
  return ok(c, await connectionsService.updateTool(id, tool, await parseBody(c, updateToolSchema)));
});

router.post("/connections/:id/tools/:tool/call", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const tool = parseStringParam(c.req.param("tool"), "tool");
  return ok(c, await connectionsService.callTool(id, tool, await parseBody(c, callToolSchema)));
});

export default router.hono;
