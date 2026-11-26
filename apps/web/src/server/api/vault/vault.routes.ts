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
import { issueStepUp, assertStepUp, verifyPassword } from "./vault.stepup";

export const vaultNoStore: Middleware = async (c, next) => {
  await next();
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

router.post("/vault/step-up/options", authRateLimiter, async (c) => {
  const { email } = requireUser(c);
  return ok(c, await passkeyService.generateAuthenticationOptions({ email }));
});

router.post("/vault/step-up", authRateLimiter, async (c) => {
  const { userId } = requireUser(c);
  const body = await parseBody(c, stepUpSchema);
  if ("password" in body) {
    if (!(await verifyPassword(userId, body.password))) throw Boom.unauthorized("Wrong password");
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

router.post("/vault/items", async (c) => {
  const body = await parseBody(c, createItemSchema);
  return ok(c, await admin.createItem(body), 201);
});

router.post("/vault/links", async (c) => {
  const body = await parseBody(c, linkItemSchema);
  return ok(c, await admin.linkItem(body), 201);
});

router.post("/vault/move-to-1password", async (c) => {
  return ok(c, await admin.moveLocalItemsToOnePassword());
});

router.put("/vault/items/:handle", async (c) => {
  const handle = handleParam(c);
  return ok(c, await admin.updateItem(handle, await parseBody(c, updateItemSchema)));
});

router.patch("/vault/items/:handle", async (c) => {
  const body = await parseBody(c, patchValueSchema);
  return ok(c, await admin.updateItem(handleParam(c), { values: { [body.field]: body.value } }));
});

router.delete("/vault/items/:handle", async (c) => {
  return ok(c, await admin.deleteItem(handleParam(c), parseQuery(c, deleteQuerySchema)));
});

router.post("/vault/items/:handle/reveal", async (c) => {
  const body = await parseBody(c, revealSchema);
  return ok(c, await admin.reveal(handleParam(c), body.field, body.purpose));
});

router.get("/vault/requests/:taskId", async (c) => {
  return ok(c, await requests.requestView(taskParam(c)));
});

router.post("/vault/requests/:taskId/submit", async (c) => {
  const taskId = taskParam(c);
  const body = await parseBody(c, submitCredentialsSchema);
  if (body.save) assertStepUp(c);
  return ok(c, await requests.submitRequest(taskId, body));
});

router.post("/vault/requests/:taskId/cancel", async (c) => {
  return ok(c, await requests.cancelRequest(taskParam(c)));
});

export default router;
