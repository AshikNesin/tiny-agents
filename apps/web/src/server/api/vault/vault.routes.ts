import { routes } from "../routes";
import { Boom } from "@groot/core/errors";
import { authRateLimiter } from "@groot/core/middlewares/rate-limit.middleware";
import * as passkeyService from "@groot/core/passkey/passkey.service";
import type { AppContext, Middleware } from "@groot/core/types";
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

const router = routes();

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

router.post("/vault/step-up/options", "signedIn", authRateLimiter, async (c) => {
  const { email } = requireUser(c);
  return ok(c, await passkeyService.generateAuthenticationOptions({ email }));
});

router.post("/vault/step-up", "signedIn", authRateLimiter, async (c) => {
  const { userId } = requireUser(c);
  const body = await parseBody(c, stepUpSchema);
  if ("password" in body) {
    if (!(await verifyPassword(userId, body.password))) throw Boom.unauthorized("Wrong password");
  } else {
    const user = await passkeyService.authenticatePasskey({
      response: body.passkey as unknown as Parameters<
        typeof passkeyService.authenticatePasskey
      >[0]["response"],
    });
    if (user.id !== userId) throw Boom.forbidden("That passkey belongs to someone else");
  }
  return ok(c, issueStepUp(userId));
});

router.post("/vault/items", "signedIn", async (c) => {
  const body = await parseBody(c, createItemSchema);
  return ok(c, await admin.createItem(body), 201);
});

router.post("/vault/links", "stepUp", async (c) => {
  const body = await parseBody(c, linkItemSchema);
  return ok(c, await admin.linkItem(body), 201);
});

router.post("/vault/move-to-1password", "signedIn", async (c) => {
  return ok(c, await admin.moveLocalItemsToOnePassword());
});

router.put("/vault/items/:handle", "stepUpForSome", async (c) => {
  const handle = handleParam(c);
  const body = await parseBody(c, updateItemSchema);
  if (body.urls !== undefined || body.policy !== undefined) assertStepUp(c);
  return ok(c, await admin.updateItem(handle, body));
});

router.patch("/vault/items/:handle", "signedIn", async (c) => {
  const body = await parseBody(c, patchValueSchema);
  return ok(c, await admin.updateItem(handleParam(c), { values: { [body.field]: body.value } }));
});

router.delete("/vault/items/:handle", "stepUp", async (c) => {
  return ok(c, await admin.deleteItem(handleParam(c), parseQuery(c, deleteQuerySchema)));
});

router.post("/vault/items/:handle/reveal", "stepUp", async (c) => {
  const body = await parseBody(c, revealSchema);
  return ok(c, await admin.reveal(handleParam(c), body.field, body.purpose));
});

router.get("/vault/requests/:taskId", async (c) => {
  return ok(c, await requests.requestView(taskParam(c)));
});

router.post("/vault/requests/:taskId/submit", "signedIn", async (c) => {
  const taskId = taskParam(c);
  const body = await parseBody(c, submitCredentialsSchema);
  return ok(c, await requests.submitRequest(taskId, body));
});

router.post("/vault/requests/:taskId/cancel", "signedIn", async (c) => {
  return ok(c, await requests.cancelRequest(taskParam(c)));
});

export default router.hono;
