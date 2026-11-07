import { createMiddleware } from "hono/factory";
import { findUserById } from "../auth/auth.service";
import { sessionInvalid, verifyToken } from "../utils/jwt.utils";
import { extractAuthToken } from "../utils/auth-cookie.utils";
import type { AppEnv } from "../types";

/** Requires a valid JWT (cookie or bearer) for an account that still exists, and sets `c.get("user")`. */
export const jwtAuthMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = extractAuthToken(c);
  if (!token) throw sessionInvalid("No token provided");
  const account = await findUserById((await verifyToken(token)).userId);
  if (!account) throw sessionInvalid("Account no longer exists");
  c.set("user", { userId: account.id, email: account.email });
  await next();
});
