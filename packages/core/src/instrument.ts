import * as Sentry from "@sentry/node";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { env } from "./env";
import { config } from "./config";
import { scrubValue } from "./logger/scrub";

// Generate release version using SOURCE_VERSION (Heroku) or SENTRY_RELEASE env var
// Must match the logic in scripts/build.mjs
const getSentryRelease = () => {
  if (env.SENTRY_RELEASE) return env.SENTRY_RELEASE;
  const sourceVersion = env.SOURCE_COMMIT || process.env.SOURCE_VERSION;
  if (sourceVersion) return `${config.app.name.toLowerCase()}@${sourceVersion.slice(0, 7)}`;
  // Fallback: read release written during build (dist/release.json)
  try {
    const distDir = path.dirname(fileURLToPath(import.meta.url));
    const releaseFile = path.join(distDir, "release.json");
    if (existsSync(releaseFile)) {
      return JSON.parse(readFileSync(releaseFile, "utf-8")).release;
    }
  } catch {
    // Ignore
  }
  return undefined;
};

// Initialize Sentry as early as possible
Sentry.init({
  // Use DSN from environment variables or fall back to the provided one if not set
  dsn: config.sentry.dsn,

  // Release identifier for source map correlation
  release: getSentryRelease(),

  // Environment for filtering in Sentry (production, development, etc.)
  environment: env.NODE_ENV,

  // Sentry 11 collects default user info without `sendDefaultPii`. The Pino
  // integration sends logs without `enableLogs`.
  integrations: [
    // https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/pino/
    Sentry.pinoIntegration(),
    // https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/zodErrors/
    Sentry.zodErrorsIntegration(),
  ],

  // Values the app registered as secret never leave in an event; request
  // bodies of the vault routes are dropped outright.
  beforeSend(event) {
    if (event.request?.url?.includes("/vault/")) delete event.request.data;
    return scrubValue(event);
  },
  beforeBreadcrumb: (breadcrumb) => scrubValue(breadcrumb),
});

export { Sentry };
