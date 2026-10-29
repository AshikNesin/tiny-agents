/**
 * Step-up re-authentication for the Vault UI's writes and reveals (issue #56
 * T13): the owner re-enters their password (or uses a passkey) and gets a
 * token valid for five minutes, held in the page's memory and sent as the
 * `X-Vault-Step-Up` header. Because a cross-site form can't set a custom
 * header, the same token is the routes' CSRF guard.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import { Boom } from "@groot/core/errors";
import { prisma } from "@groot/core/database";

export const STEP_UP_HEADER = "x-vault-step-up";
export const STEP_UP_TTL_MS = 5 * 60_000;

const tokens = new Map<string, { userId: number; expiresAt: number }>();

function prune(): void {
  const now = Date.now();
  for (const [token, grant] of tokens) if (grant.expiresAt <= now) tokens.delete(token);
}

export function issueStepUp(userId: number): { token: string; expiresAt: number } {
  prune();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + STEP_UP_TTL_MS;
  tokens.set(token, { userId, expiresAt });
  return { token, expiresAt };
}

export function validStepUp(token: string | undefined, userId: number): boolean {
  if (!token) return false;
  prune();
  for (const [candidate, grant] of tokens) {
    const a = Buffer.from(candidate);
    const b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a, b)) return grant.userId === userId;
  }
  return false;
}

/** Route guard: a fresh step-up token from this user. */
export function requireStepUp(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.user?.userId;
  if (userId === undefined || !validStepUp(req.get(STEP_UP_HEADER), userId)) {
    next(Boom.forbidden("Confirm it's you first (step-up required)", { code: "step_up_required" }));
    return;
  }
  next();
}

/** The owner's password, checked against their account. */
export async function verifyPassword(userId: number, password: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
  if (!user?.password) return false;
  return bcrypt.compare(password, user.password);
}

/** Test seam. */
export function clearStepUpsForTests(): void {
  tokens.clear();
}
