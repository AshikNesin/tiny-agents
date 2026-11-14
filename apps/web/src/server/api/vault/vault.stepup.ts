/**
 * Step-up re-authentication for the Vault UI's writes and reveals (issue #56
 * T13): the owner re-enters their password (or uses a passkey) and gets a
 * token valid for five minutes, held in the page's memory and sent as the
 * `X-Vault-Step-Up` header. Because a cross-site form can't set a custom
 * header, the same token is the routes' CSRF guard.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import type { Middleware } from "@groot/core/types";
import { verifyPassword as checkPassword } from "@groot/core/utils/password.utils";
import { db, users } from "../../db";
import { app } from "../../app-root";
import type { StepUpToken } from "../../../shared/api/vault";

const STEP_UP_HEADER = "x-vault-step-up";
const STEP_UP_TTL_MS = 5 * 60_000;

function prune(): void {
  const tokens = app().vaultStepUps;
  const now = Date.now();
  for (const [token, grant] of tokens) if (grant.expiresAt <= now) tokens.delete(token);
}

export function issueStepUp(userId: number): StepUpToken {
  prune();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + STEP_UP_TTL_MS;
  app().vaultStepUps.set(token, { userId, expiresAt });
  return { token, expiresAt };
}

function validStepUp(token: string | undefined, userId: number): boolean {
  if (!token) return false;
  prune();
  for (const [candidate, grant] of app().vaultStepUps) {
    const a = Buffer.from(candidate);
    const b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a, b)) return grant.userId === userId;
  }
  return false;
}

/** Throw 403 `step_up_required` unless the request carries a fresh step-up token from this user. */
export function assertStepUp(c: Parameters<Middleware>[0]): void {
  const userId = c.get("user")?.userId;
  if (userId === undefined || !validStepUp(c.req.header(STEP_UP_HEADER), userId)) {
    throw Boom.forbidden("Confirm it's you first (step-up required)", { code: "step_up_required" });
  }
}

/** Route guard: a fresh step-up token from this user. */
export const requireStepUp: Middleware = async (c, next) => {
  assertStepUp(c);
  await next();
};

/**
 * The owner's password, checked against their account. Core's check accepts
 * both its PBKDF2 hashes and the bcrypt hashes of accounts made before groot 3.0.
 */
export async function verifyPassword(userId: number, password: string): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { password: true },
  });
  if (!user?.password) return false;
  return checkPassword(password, user.password);
}

/** Test seam. */
export function clearStepUpsForTests(): void {
  app().vaultStepUps.clear();
}
