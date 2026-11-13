import { defineConfig } from "@groot/core/config";
import { appEnv } from "./env";

/**
 * tiny-agents' project DSN (it lived in config.yml before groot 3.0). Used in
 * production when SENTRY_DSN is unset; a DSN only lets clients send events.
 */
const TINY_AGENTS_SENTRY_DSN =
  "https://52e040a585453b926b90c3cff35506d3@o223853.ingest.us.sentry.io/4511466064773120";

/**
 * App configuration. Anything not set here comes from `defaultConfig()` in
 * `@groot/core/config`, which derives the rest from the environment
 * (`NODE_ENV`, `PORT`, `CORS_ALLOWED_ORIGINS`, `RP_*`, `LOG_LEVEL`, ...).
 */
export const appConfig = defineConfig((env) => ({
  app: { name: "tiny-agents" },
  // Unset keeps core's 20 per 15 minutes (`undefined` is ignored by the merge).
  rateLimits: { auth: { max: appEnv().AUTH_RATE_LIMIT_MAX } },
  sentry: {
    dsn: env.SENTRY_DSN ?? (env.NODE_ENV === "production" ? TINY_AGENTS_SENTRY_DSN : ""),
  },
}));
