import { Hono } from "hono";
import { adminAuthMiddleware } from "../middlewares/admin-auth.middleware";
import { adminRateLimiter, authRateLimiter } from "../middlewares/rate-limit.middleware";
import { parseBody, requireUser } from "../utils/controller.utils";
import { endSession, requireSession, startSession } from "../session";
import { ok } from "../utils/api-response.utils";
import * as authService from "./auth.service";
import { createUserSchema, loginSchema } from "./auth.schema";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();

router.post("/login", authRateLimiter, async (c) => {
  const body = await parseBody(c, loginSchema);
  return ok(c, await startSession(c, await authService.authenticate(body)));
});

router.get("/setup", async (c) => {
  return ok(c, { needsSetup: !(await authService.hasAnyUser()) });
});

router.post("/setup", authRateLimiter, async (c) => {
  const body = await parseBody(c, createUserSchema);
  return ok(c, await startSession(c, await authService.setupFirstUser(body)), 201);
});

router.post("/logout", requireSession, async (c) => {
  await endSession(c);
  return ok(c, { status: "logged out" });
});

router.get("/me", requireSession, async (c) => {
  const { userId } = requireUser(c);
  return ok(c, await authService.getUserById({ userId }));
});

router.post("/users", adminRateLimiter, adminAuthMiddleware, async (c) => {
  const body = await parseBody(c, createUserSchema);
  return ok(c, await authService.createUser(body), 201);
});

router.get("/users", adminRateLimiter, adminAuthMiddleware, async (c) => {
  return ok(c, await authService.getAllUsers());
});

export default router;
