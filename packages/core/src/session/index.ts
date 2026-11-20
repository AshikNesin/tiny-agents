import { createMiddleware } from "hono/factory";
import { Boom, ErrorCode, type HttpError } from "../errors";
import { findUserById } from "../auth/auth.service";
import type { SessionUser, SignInResponse } from "../auth/auth.schema";
import type { AppContext, AppEnv, AuthUser } from "../types";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./cookie";
import { decodeSessionToken, issueSession } from "./token";

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

export function endSession(c: AppContext): void {
  clearSessionCookie(c);
}

export async function verifySessionToken(token: string): Promise<AuthUser> {
  const claims = await decodeSessionToken(token);
  if (!claims) throw sessionInvalid("Invalid or expired token");
  return claims;
}

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = readSessionToken(c);
  if (!token) throw sessionInvalid("No token provided");
  const account = await findUserById((await verifySessionToken(token)).userId);
  if (!account) throw sessionInvalid("Account no longer exists");
  c.set("user", { userId: account.id, email: account.email });
  await next();
});
