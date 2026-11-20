import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import { defaultBodyLimit } from "./middlewares/body-limit.middleware";
import { requestLoggerMiddleware } from "./middlewares/request-logger.middleware";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler.middleware";
import { cloudflareRateLimitStore } from "./rate-limit/cloudflare";
import { memoryRateLimitStore, type RateLimitStore } from "./rate-limit/store";
import type { AppEnv } from "./types";
import type { ClientAddressResolver } from "./utils/client-ip";

export interface CreateAppOptions {
  routes?: (app: Hono<AppEnv>) => void;
  readiness?: () => string | undefined;
  bodyLimitBytes?: number;
  /**
   * @deprecated Declare the limit on the route with `routeBodyLimit()`, which holds wherever the
   * router is mounted; a path here breaks when it moves.
   */
  uploadPaths?: string[];
  clientAddress?: ClientAddressResolver;
  rateLimitStore?: RateLimitStore;
  openCorsPaths?: string[];
}

function matchesPath(paths: readonly string[], path: string): boolean {
  return paths.some((p) => (p.endsWith("*") ? path.startsWith(p.slice(0, -1)) : path === p));
}

let shuttingDown = false;

export function markShuttingDown(): void {
  shuttingDown = true;
}

export function createApp(options: CreateAppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const rateLimitMemory = memoryRateLimitStore();

  const openPaths = options.openCorsPaths ?? [];
  const openCors = cors({ origin: "*" });
  const appCors = cors({
    origin: (origin) =>
      config.cors.origins.length === 0 || config.cors.origins.includes(origin) ? origin : null,
    credentials: true,
  });

  app.use((c, next) => {
    if (options.clientAddress) c.set("clientAddress", options.clientAddress);
    c.set(
      "rateLimitStore",
      options.rateLimitStore ?? cloudflareRateLimitStore(c.env ?? {}, rateLimitMemory),
    );
    return next();
  });
  app.use(requestLoggerMiddleware);
  app.use((c, next) => (matchesPath(openPaths, c.req.path) ? openCors(c, next) : appCors(c, next)));
  const skipPaths = options.uploadPaths ?? [];
  app.use(
    "/api/*",
    defaultBodyLimit(options.bodyLimitBytes ?? 1024 * 1024, (c) =>
      matchesPath(skipPaths, c.req.path),
    ),
  );

  const probe = () => {
    if (shuttingDown) return { status: 503 as const, body: { status: "shutting_down" } };
    const reason = options.readiness?.();
    if (reason) return { status: 503 as const, body: { status: "not_ready", reason } };
    return { status: 200 as const, body: { status: "ok" } };
  };

  app.get("/health", (c) => {
    const { status, body } = probe();
    return c.json({ ...body, timestamp: new Date().toISOString() }, status);
  });
  app.get("/ready", (c) => {
    const { status, body } = probe();
    return c.json(
      status === 200 ? { ready: true } : { ready: false, reason: body.reason ?? body.status },
      status,
    );
  });

  options.routes?.(app);

  app.notFound(notFoundHandler);
  app.onError(errorHandler);
  return app;
}
