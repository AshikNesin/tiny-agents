import { SignJWT, jwtVerify } from "jose";
import ms from "ms";
import { env } from "../env";
import { config } from "../config";
import { utf8Encode } from "../utils/encoding.utils";
import type { SessionUser, SignInResponse } from "../auth/auth.schema";
import type { AuthUser } from "../types";

const ALGORITHM = "HS256";

function secret(): Uint8Array {
  return utf8Encode(env.JWT_SECRET_KEY);
}

export function sessionLifetimeMs(): number {
  const parsed = ms(config.auth.jwtExpiresIn as ms.StringValue);
  if (typeof parsed !== "number" || Number.isNaN(parsed)) {
    throw new Error(`Invalid auth.jwtExpiresIn: ${config.auth.jwtExpiresIn}`);
  }
  return parsed;
}

export async function signSessionToken(user: AuthUser): Promise<string> {
  return new SignJWT({ userId: user.userId, email: user.email })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(config.auth.jwtExpiresIn)
    .sign(secret());
}

export async function issueSession({ id, email, name }: SessionUser): Promise<SignInResponse> {
  const token = await signSessionToken({ userId: id, email });
  return { token, user: { id, email, name } };
}

export async function decodeSessionToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALGORITHM] });
    if (typeof payload.userId !== "number" || typeof payload.email !== "string") return null;
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}
