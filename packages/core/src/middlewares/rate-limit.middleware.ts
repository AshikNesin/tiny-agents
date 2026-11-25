import { createMiddleware } from "hono/factory";
import { Boom, ErrorCode, type ErrorCodeValue } from "../errors";
import { config, type RateLimitWindow } from "../config";
import { cloudflareRateLimitStore } from "../rate-limit/cloudflare";
import { memoryRateLimitStore, type RateLimitStore } from "../rate-limit/store";
import { rateLimitKey } from "../utils/client-address";
import { clientIp } from "../utils/controller.utils";
import type { AppContext, AppEnv } from "../types";

export interface RateLimitOptions {
  window: () => RateLimitWindow;
  message: string;
  code?: ErrorCodeValue;
  name?: string;
  binding?: string;
}

let unnamed = 0;

let processStore: RateLimitStore | undefined;
export function rateLimitStoreFor(c: AppContext): RateLimitStore {
  const store = c.get("rateLimitStore");
  if (store) return store;
  processStore ??= memoryRateLimitStore();
  return cloudflareRateLimitStore(c.env ?? {}, processStore);
}

export function rateLimit(options: RateLimitOptions) {
  unnamed += 1;
  const name = options.name ?? options.binding ?? `rate-limit-${unnamed}`;

  return createMiddleware<AppEnv>(async (c, next) => {
    const { windowMs, max } = options.window();
    const key = rateLimitKey(clientIp(c));
    const result = await rateLimitStoreFor(c).hit(key, {
      name,
      windowMs,
      max,
      binding: options.binding,
    });

    const resetSeconds =
      result.resetAt === undefined
        ? undefined
        : String(Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000)));
    if (result.limit !== undefined) c.header("RateLimit-Limit", String(result.limit));
    if (result.remaining !== undefined) c.header("RateLimit-Remaining", String(result.remaining));
    if (resetSeconds !== undefined) c.header("RateLimit-Reset", resetSeconds);

    if (!result.allowed) {
      if (resetSeconds !== undefined) c.header("Retry-After", resetSeconds);
      throw Boom.tooManyRequests(options.message, null, options.code);
    }
    await next();
  });
}

export const authRateLimiter = rateLimit({
  window: () => config.rateLimits.auth,
  message: "Too many attempts",
  code: ErrorCode.RATE_LIMIT_EXCEEDED.code,
  binding: "AUTH_RATE_LIMITER",
});

export const storageRateLimiter = rateLimit({
  window: () => config.rateLimits.storage,
  message: "Too many storage operations from this IP, please try again later.",
  code: ErrorCode.RATE_LIMIT_EXCEEDED.code,
  binding: "STORAGE_RATE_LIMITER",
});

export const adminRateLimiter = rateLimit({
  window: () => config.rateLimits.admin,
  message: "Too many attempts",
  code: ErrorCode.RATE_LIMIT_EXCEEDED.code,
  binding: "ADMIN_RATE_LIMITER",
});

export const uploadRateLimiter = rateLimit({
  window: () => config.rateLimits.upload,
  message: "Too many file uploads from this IP, please try again later.",
  code: ErrorCode.UPLOAD_RATE_LIMIT_EXCEEDED.code,
  binding: "UPLOAD_RATE_LIMITER",
});
