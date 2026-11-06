/**
 * The Vault routes (issue #56), owner-only. Writes, reveals and copies need a
 * fresh step-up token (`X-Vault-Step-Up`, which doubles as the CSRF guard).
 * Every response is `Cache-Control: no-store`; request bodies are never
 * logged (the request logger logs none) and are dropped from Sentry events.
 * None of this is reachable from an agent tool.
 */
import { Hono } from "hono";
import { Boom } from "@groot/core/errors";
import { authRateLimiter } from "@groot/core/middlewares/rate-limit.middleware";
import * as passkeyService from "@groot/core/passkey/passkey.service";
import type { AppContext, AppEnv, Middleware } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import {
  parseBody,
  parseQuery,
  parseStringParam,
  requireUser,
} from "@groot/core/utils/controller.utils";
import * as admin from "./vault.admin.service";
import * as requests from "./vault.requests.service";
import {
  createItemSchema,
  deleteQuerySchema,
  linkItemSchema,
  patchValueSchema,
  revealSchema,
  stepUpSchema,
  submitCredentialsSchema,
  updateItemSchema,
} from "./vault.schema";
import { issueStepUp, requireStepUp, verifyPassword } from "./vault.stepup";

/** `Cache-Control: no-store` on every vault response (mounted on `/vault/*` by `app.ts`). */
export const vaultNoStore: Middleware = async (c, next) => {
  await next();
  // After the handler, so error responses carry it too.
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
};

const router = new Hono<AppEnv>();

const handleParam = (c: AppContext) =>
  parseStringParam(c.req.param("handle"), "handle").toLowerCase();

function taskParam(c: AppContext): number {
  const taskId = Number(parseStringParam(c.req.param("taskId"), "taskId"));
  if (!Number.isInteger(taskId) || taskId <= 0) throw Boom.badRequest("Invalid request id");
  return taskId;
}

router.get("/vault", async (c) => {
  return ok(c, await admin.overview({ refresh: c.req.query("refresh") === "1" }));
});

router.get("/vault/items/:handle", async (c) => {
  return ok(c, await admin.detail(handleParam(c)));
});

// ── Step-up ─────────────────────────────────────────────────────────────

router.post("/vault/step-up/options", authRateLimiter, async (c) => {
  const { email } = requireUser(c);
  return ok(c, await passkeyService.generateAuthenticationOptions({ email }));
});

// A refused confirmation is 403, never 401: the client treats any 401 as an
// expired session and signs the owner out (#164).
router.post("/vault/step-up", authRateLimiter, async (c) => {
  const { userId } = requireUser(c);
  const body = await parseBody(c, stepUpSchema);
  if ("password" in body) {
    if (!(await verifyPassword(userId, body.password))) throw Boom.forbidden("Wrong password");
  } else {
    const result = await passkeyService.verifyAuthentication({
      response: body.passkey as unknown as Parameters<
        typeof passkeyService.verifyAuthentication
      >[0]["response"],
    });
    if (result.user.id !== userId) throw Boom.forbidden("That passkey belongs to someone else");
  }
  return ok(c, issueStepUp(userId));
});

// ── Items (step-up) ─────────────────────────────────────────────────────

router.post("/vault/items", requireStepUp, async (c) => {
  const body = await parseBody(c, createItemSchema);
  return ok(c, await admin.createItem(body), 201);
});

router.post("/vault/links", requireStepUp, async (c) => {
  const body = await parseBody(c, linkItemSchema);
  return ok(c, await admin.linkItem(body), 201);
});

router.put("/vault/items/:handle", requireStepUp, async (c) => {
  const handle = handleParam(c);
  return ok(c, await admin.updateItem(handle, await parseBody(c, updateItemSchema)));
});

router.patch("/vault/items/:handle", requireStepUp, async (c) => {
  const body = await parseBody(c, patchValueSchema);
  return ok(c, await admin.updateItem(handleParam(c), { values: { [body.field]: body.value } }));
});

router.delete("/vault/items/:handle", requireStepUp, async (c) => {
  return ok(c, await admin.deleteItem(handleParam(c), parseQuery(c, deleteQuerySchema)));
});

router.post("/vault/items/:handle/reveal", requireStepUp, async (c) => {
  const body = await parseBody(c, revealSchema);
  return ok(c, await admin.reveal(handleParam(c), body.field, body.purpose));
});

// ── Credential requests ─────────────────────────────────────────────────

router.get("/vault/requests/:taskId", async (c) => {
  return ok(c, await requests.requestView(taskParam(c)));
});

router.post("/vault/requests/:taskId/submit", async (c) => {
  const taskId = taskParam(c);
  return ok(c, await requests.submitRequest(taskId, await parseBody(c, submitCredentialsSchema)));
});

router.post("/vault/requests/:taskId/cancel", async (c) => {
  return ok(c, await requests.cancelRequest(taskParam(c)));
});

export default router;
