import type { Request, Response } from "express";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import { logger } from "@groot/core/logger";
import * as connectionsService from "./connections.service";
import { getConnectionManager } from "./connections.manager";
import { clientMetadata, clientMetadataUrl } from "./oauth";
import {
  createConnectionSchema,
  testConnectionSchema,
  updateConnectionSchema,
} from "./connections.schema";

/**
 * Public routes: reachable without a session. The OAuth metadata document is
 * fetched by authorization servers (no credentials possible), and the OAuth
 * redirect target is a cross-site browser navigation — the session cookie
 * (SameSite=Strict in production) is not attached and a navigation carries no
 * Authorization header. The callback is authorized by the `state` parameter,
 * which matches only a pending sign-in started by the connection's owner.
 */
export const publicConnectionsRouter = createRouter();

publicConnectionsRouter.get(
  "/connections/oauth/client-metadata.json",
  async (_req: Request, res: Response) => {
    res.json({ ...clientMetadata(), client_id: clientMetadataUrl() });
    return undefined;
  },
);

/**
 * OAuth redirect target. In the sign-in popup it reports back to the opener
 * and closes; opened as a full page (mobile) it returns to the connection.
 */
publicConnectionsRouter.get("/connections/oauth/callback", async (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const denied = typeof req.query.error === "string" ? req.query.error : undefined;
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
  res
    .status(200)
    .type("html")
    .send(
      `<!doctype html><meta charset="utf-8"><title>Signed in</title><script>` +
        `if (window.opener) { window.opener.postMessage(${payload}, location.origin); window.close(); }` +
        ` else { location.replace(${JSON.stringify(fallback)}); }` +
        `</script>`,
    );
  return undefined;
});

const router = createRouter();

router.get("/connections", async () => connectionsService.list());

router.post("/connections/test", async (req: Request) => {
  return connectionsService.test(parseBody(req, testConnectionSchema));
});

router.post("/connections", async (req: Request, res: Response) => {
  const payload = parseBody(req, createConnectionSchema);
  res.status(201);
  return connectionsService.create(payload);
});

router.get("/connections/:id", async (req: Request) => {
  return connectionsService.get(parseStringParam(req.params.id, "id"));
});

router.patch("/connections/:id", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  return connectionsService.update(id, parseBody(req, updateConnectionSchema));
});

router.delete("/connections/:id", async (req: Request) => {
  await connectionsService.remove(parseStringParam(req.params.id, "id"));
  return { deleted: true };
});

router.post("/connections/:id/reconnect", async (req: Request) => {
  return connectionsService.reconnect(parseStringParam(req.params.id, "id"));
});

router.post("/connections/:id/authorize", async (req: Request) => {
  return connectionsService.authorize(parseStringParam(req.params.id, "id"));
});

export default router;
