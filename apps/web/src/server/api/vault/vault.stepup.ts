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

export function assertStepUp(c: Parameters<Middleware>[0]): void {
  const userId = c.get("user")?.userId;
  if (userId === undefined || !validStepUp(c.req.header(STEP_UP_HEADER), userId)) {
    throw Boom.forbidden("Confirm it's you first (step-up required)", { code: "step_up_required" });
  }
}

export async function verifyPassword(userId: number, password: string): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { password: true },
  });
  if (!user?.password) return false;
  return checkPassword(password, user.password);
}

export function clearStepUpsForTests(): void {
  app().vaultStepUps.clear();
}
