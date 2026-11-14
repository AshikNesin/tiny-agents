import { Hono } from "hono";
import type { AppContext, AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import { logger } from "@groot/core/logger";
import * as connectionsService from "./connections.service";
import { getConnectionManager } from "./connections.manager";
import { clientMetadata, clientMetadataUrl } from "./oauth";
import {
  callToolSchema,
  createConnectionSchema,
  testConnectionSchema,
  updateConnectionSchema,
  updateToolSchema,
} from "./connections.schema";

/**
 * Public routes: reachable without a session. The OAuth metadata document is
 * fetched by authorization servers (no credentials possible), and the OAuth
 * redirect target is a cross-site browser navigation: the session cookie
 * (SameSite=Strict in production) is not attached and a navigation carries no
 * Authorization header. The callback is authorized by the `state` parameter,
 * which matches only a pending sign-in started by the connection's owner.
 */
export const publicConnectionsRouter = new Hono<AppEnv>();

publicConnectionsRouter.get("/connections/oauth/client-metadata.json", (c) =>
  c.json({ ...clientMetadata(), client_id: clientMetadataUrl() }),
);

/** A query parameter given exactly once (a repeated one is ignored, as before). */
function singleQuery(c: AppContext, name: string): string | undefined {
  const values = c.req.queries(name);
  return values?.length === 1 ? values[0] : undefined;
}

/**
 * OAuth redirect target. In the sign-in popup it reports back to the opener
 * and closes; opened as a full page (mobile) it returns to the connection.
 */
publicConnectionsRouter.get("/connections/oauth/callback", async (c) => {
  const code = singleQuery(c, "code");
  const state = singleQuery(c, "state");
  const denied = singleQuery(c, "error");
  let id: string | undefined;
  let error = denied;
  if (!error && code && state) {
    try {
      id = await getConnectionManager().finishAuthorization(state, code);
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

const router = new Hono<AppEnv>();

router.get("/connections", async (c) => ok(c, await connectionsService.list()));

router.post("/connections/test", async (c) => {
  return ok(c, await connectionsService.test(await parseBody(c, testConnectionSchema)));
});

router.post("/connections", async (c) => {
  const payload = await parseBody(c, createConnectionSchema);
  return ok(c, await connectionsService.create(payload), 201);
});

router.get("/connections/:id", async (c) => {
  return ok(c, await connectionsService.get(parseStringParam(c.req.param("id"), "id")));
});

router.patch("/connections/:id", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  return ok(c, await connectionsService.update(id, await parseBody(c, updateConnectionSchema)));
});

router.delete("/connections/:id", async (c) => {
  await connectionsService.remove(parseStringParam(c.req.param("id"), "id"));
  return ok(c, { deleted: true });
});

router.post("/connections/:id/reconnect", async (c) => {
  return ok(c, await connectionsService.reconnect(parseStringParam(c.req.param("id"), "id")));
});

router.post("/connections/:id/authorize", async (c) => {
  return ok(c, await connectionsService.authorize(parseStringParam(c.req.param("id"), "id")));
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

router.patch("/connections/:id/tools/:tool", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const tool = parseStringParam(c.req.param("tool"), "tool");
  return ok(c, await connectionsService.updateTool(id, tool, await parseBody(c, updateToolSchema)));
});

router.post("/connections/:id/tools/:tool/call", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const tool = parseStringParam(c.req.param("tool"), "tool");
  return ok(c, await connectionsService.callTool(id, tool, await parseBody(c, callToolSchema)));
});

export default router;
