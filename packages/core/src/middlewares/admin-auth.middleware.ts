import { createMiddleware } from "hono/factory";
import { Boom } from "../errors";
import { env } from "../env";
import { config } from "../config";
import { timingSafeEqual, utf8Encode } from "../utils/encoding.utils";
import { clientIp } from "../utils/controller.utils";
import { rateLimitKey } from "../utils/client-address";
import { rateLimitStoreFor } from "./rate-limit.middleware";
import type { AppEnv } from "../types";

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", utf8Encode(value)));
}

export const adminAuthMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const provided = c.req.header("x-admin-auth-key");
  if (!provided) throw Boom.unauthorized("Admin authentication required");
  const [a, b] = await Promise.all([sha256(provided), sha256(env.ADMIN_AUTH_KEY)]);
  if (timingSafeEqual(a, b)) {
    await next();
    return;
  }
  const { windowMs, max } = config.rateLimits.adminKey;
  const result = await rateLimitStoreFor(c).hit(rateLimitKey(clientIp(c)), {
    name: "admin-key",
    windowMs,
    max,
  });
  if (!result.allowed) {
    throw Boom.tooManyRequests(
      "Too many invalid admin keys from this IP, try again later.",
      null,
      "RATE_LIMIT_EXCEEDED",
    );
  }
  throw Boom.forbidden("Invalid admin auth key");
});
