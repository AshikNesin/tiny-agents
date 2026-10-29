/**
 * The Vault routes (issue #56), owner-only. Writes, reveals and copies need a
 * fresh step-up token (`X-Vault-Step-Up`, which doubles as the CSRF guard).
 * Every response is `Cache-Control: no-store`; request bodies are never
 * logged (the request logger logs none) and are dropped from Sentry events.
 * None of this is reachable from an agent tool.
 */
import type { NextFunction, Request, Response } from "express";
import { Boom } from "@groot/core/errors";
import { authRateLimiter } from "@groot/core/middlewares/rate-limit.middleware";
import * as passkeyService from "@groot/core/passkey/passkey.service";
import {
  parseBody,
  parseQuery,
  parseStringParam,
  requireUser,
} from "@groot/core/utils/controller.utils";
import { createRouter } from "@groot/core/utils/router.utils";
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

/** `Cache-Control: no-store` on every vault response. */
export function vaultNoStore(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/vault" || req.path.startsWith("/vault/")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
  }
  next();
}

const router = createRouter();

const handleParam = (req: Request) => parseStringParam(req.params.handle, "handle").toLowerCase();

function taskParam(req: Request): number {
  const taskId = Number(parseStringParam(req.params.taskId, "taskId"));
  if (!Number.isInteger(taskId) || taskId <= 0) throw Boom.badRequest("Invalid request id");
  return taskId;
}

router.get("/vault", async (req: Request) => {
  return await admin.overview({ refresh: req.query.refresh === "1" });
});

router.get("/vault/items/:handle", async (req: Request) => {
  return await admin.detail(handleParam(req));
});

// ── Step-up ─────────────────────────────────────────────────────────────

router.post("/vault/step-up/options", authRateLimiter, async (req: Request) => {
  const { email } = requireUser(req);
  return await passkeyService.generateAuthenticationOptions({ email });
});

router.post("/vault/step-up", authRateLimiter, async (req: Request) => {
  const { userId } = requireUser(req);
  const body = parseBody(req, stepUpSchema);
  if ("password" in body) {
    if (!(await verifyPassword(userId, body.password))) throw Boom.unauthorized("Wrong password");
  } else {
    const result = await passkeyService.verifyAuthentication({
      response: body.passkey as unknown as Parameters<
        typeof passkeyService.verifyAuthentication
      >[0]["response"],
    });
    if (result.user.id !== userId) throw Boom.unauthorized("That passkey belongs to someone else");
  }
  return issueStepUp(userId);
});

// ── Items (step-up) ─────────────────────────────────────────────────────

router.post("/vault/items", requireStepUp, async (req: Request, res: Response) => {
  const body = parseBody(req, createItemSchema);
  res.status(201);
  return await admin.createItem(body);
});

router.post("/vault/links", requireStepUp, async (req: Request, res: Response) => {
  const body = parseBody(req, linkItemSchema);
  res.status(201);
  return await admin.linkItem(body);
});

router.put("/vault/items/:handle", requireStepUp, async (req: Request) => {
  return await admin.updateItem(handleParam(req), parseBody(req, updateItemSchema));
});

router.patch("/vault/items/:handle", requireStepUp, async (req: Request) => {
  const body = parseBody(req, patchValueSchema);
  return await admin.updateItem(handleParam(req), { values: { [body.field]: body.value } });
});

router.delete("/vault/items/:handle", requireStepUp, async (req: Request) => {
  return await admin.deleteItem(handleParam(req), parseQuery(req, deleteQuerySchema));
});

router.post("/vault/items/:handle/reveal", requireStepUp, async (req: Request) => {
  const body = parseBody(req, revealSchema);
  return await admin.reveal(handleParam(req), body.field, body.purpose);
});

// ── Credential requests ─────────────────────────────────────────────────

router.get("/vault/requests/:taskId", async (req: Request) => {
  return await requests.requestView(taskParam(req));
});

router.post("/vault/requests/:taskId/submit", async (req: Request) => {
  return await requests.submitRequest(taskParam(req), parseBody(req, submitCredentialsSchema));
});

router.post("/vault/requests/:taskId/cancel", async (req: Request) => {
  return await requests.cancelRequest(taskParam(req));
});

export default router;
