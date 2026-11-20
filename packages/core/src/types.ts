import type { Context, MiddlewareHandler } from "hono";
import type { Logger } from "./logger";
import type { RateLimitStore } from "./rate-limit/store";
import type { ClientAddressResolver } from "./utils/client-ip";

export interface AuthUser {
  userId: number;
  email: string;
}

export type AppEnv = {
  Bindings: Record<string, unknown>;
  Variables: {
    user?: AuthUser;
    logger: Logger;
    requestId: string;
    clientAddress?: ClientAddressResolver;
    rateLimitStore?: RateLimitStore;
  };
};

export type AppContext = Context<AppEnv>;
export type Middleware = MiddlewareHandler<AppEnv>;
