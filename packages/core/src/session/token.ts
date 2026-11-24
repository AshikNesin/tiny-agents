import { SignJWT, jwtVerify } from "jose";
import ms from "ms";
import { env } from "../env";
import { config } from "../config";
import { utf8Encode } from "../utils/encoding.utils";
import { eq } from "drizzle-orm";
import { db, users } from "../database";
import type { SessionUser, SignInResponse } from "../auth/auth.schema";
import type { SessionClaims } from "../types";

const ALGORITHM = "HS256";

function secret(): Uint8Array {
  return utf8Encode(env.JWT_SECRET_KEY);
}

export function tokenVersionOf(claims: SessionClaims): number {
  return claims.tokenVersion ?? 0;
}

export function sessionLifetimeMs(): number {
  const parsed = ms(config.auth.jwtExpiresIn as ms.StringValue);
  if (typeof parsed !== "number" || Number.isNaN(parsed)) {
    throw new Error(`Invalid auth.jwtExpiresIn: ${config.auth.jwtExpiresIn}`);
  }
  return parsed;
}

export async function signSessionToken(user: SessionClaims): Promise<string> {
  return new SignJWT({
    userId: user.userId,
    email: user.email,

    tokenVersion: tokenVersionOf(user),
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(config.auth.jwtExpiresIn)
    .sign(secret());
}

export async function issueSession({
  id,
  email,
  name,
  isAdmin,
}: SessionUser): Promise<SignInResponse> {
  const [row] = await db
    .select({ tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  const token = await signSessionToken({ userId: id, email, tokenVersion: row?.tokenVersion ?? 0 });
  return { token, user: { id, email, name, isAdmin } };
}

export async function decodeSessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALGORITHM] });
    if (typeof payload.userId !== "number" || typeof payload.email !== "string") return null;
    if (payload.tokenVersion !== undefined && typeof payload.tokenVersion !== "number") return null;
    return { userId: payload.userId, email: payload.email, tokenVersion: payload.tokenVersion };
  } catch {
    return null;
  }
}
