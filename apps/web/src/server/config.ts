import { defineConfig } from "@groot/core/config";
import { appEnv } from "./env";

const TINY_AGENTS_SENTRY_DSN =
  "https://52e040a585453b926b90c3cff35506d3@o223853.ingest.us.sentry.io/4511466064773120";

export const appConfig = defineConfig((env) => ({
  app: { name: "tiny-agents" },
  rateLimits: { auth: { max: appEnv().AUTH_RATE_LIMIT_MAX } },
  sentry: {
    dsn: env.SENTRY_DSN ?? (env.NODE_ENV === "production" ? TINY_AGENTS_SENTRY_DSN : ""),
  },
}));
