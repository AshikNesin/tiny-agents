import { eq, sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { Boom, ErrorCode, type HttpError } from "../errors";
import { db, users } from "../database";
import { findUserById } from "../auth/auth.service";
import type { SessionUser, SignInResponse } from "../auth/auth.schema";
import type { AppContext, AppEnv, SessionClaims } from "../types";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./cookie";
import { decodeSessionToken, issueSession, tokenVersionOf } from "./token";

function sessionInvalid(message: string): HttpError {
  return Boom.unauthorized(message, undefined, ErrorCode.SESSION_INVALID.code);
}

export function isSessionInvalid(error: HttpError): boolean {
  return error.code === ErrorCode.SESSION_INVALID.code;
}

export async function startSession(c: AppContext, account: SessionUser): Promise<SignInResponse> {
  const body = await issueSession(account);
  setSessionCookie(c, body.token);
  return body;
}

export async function endSession(c: AppContext): Promise<void> {
  clearSessionCookie(c);
  const { userId } = c.get("user") ?? {};
  if (userId === undefined) return;
  await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId));
}

export async function verifySessionToken(token: string): Promise<SessionClaims> {
  const claims = await decodeSessionToken(token);
  if (!claims) throw sessionInvalid("Invalid or expired token");
  return claims;
}

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = readSessionToken(c);
  if (!token) throw sessionInvalid("No token provided");
  const claims = await verifySessionToken(token);
  const account = await findUserById(claims.userId);
  if (!account) throw sessionInvalid("Account no longer exists");
  if (tokenVersionOf(claims) !== account.tokenVersion) {
    throw sessionInvalid("Session ended: sign in again");
  }

  c.set("user", { userId: account.id, email: account.email, isAdmin: account.isAdmin });
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) throw sessionInvalid("No token provided");
  if (!c.get("user")!.isAdmin) throw Boom.forbidden("Admin access required");
  await next();
});
