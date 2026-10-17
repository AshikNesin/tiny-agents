import rateLimit from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";
import { Boom, ErrorCode } from "@groot/core/errors";
import { config } from "@groot/core/config";

export const authRateLimiter = rateLimit({
  windowMs: config.rateLimits.auth.windowMs,
  max: config.rateLimits.auth.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(Boom.tooManyRequests("Too many attempts", null, ErrorCode.RATE_LIMIT_EXCEEDED.code));
  },
});

export const storageRateLimiter = rateLimit({
  windowMs: config.rateLimits.storage.windowMs,
  max: config.rateLimits.storage.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(
      Boom.tooManyRequests(
        "Too many storage operations from this IP, please try again later.",
        null,
        ErrorCode.RATE_LIMIT_EXCEEDED.code,
      ),
    );
  },
});

export const uploadRateLimiter = rateLimit({
  windowMs: config.rateLimits.upload.windowMs,
  max: config.rateLimits.upload.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(
      Boom.tooManyRequests(
        "Too many file uploads from this IP, please try again later.",
        null,
        ErrorCode.UPLOAD_RATE_LIMIT_EXCEEDED.code,
      ),
    );
  },
});
