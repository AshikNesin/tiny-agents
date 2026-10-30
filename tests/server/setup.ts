/**
 * Vitest setup for server tests: a fresh in-memory SQLite database per test
 * file (migrations applied), in-memory file storage, jobs disabled so tests
 * drive `runTick()` explicitly, silent logs.
 */
import { bootstrap } from "@groot/core/bootstrap";
import { createSqliteDb } from "@groot/core/database/node";
import { memoryStorage } from "@groot/core/storage/memory";

process.env.NODE_ENV = "test";
// Connection-secret encryption needs a key in tests (unset in dev until
// connections with auth are added).
process.env.SECRETS_KEY ??= "test-only-secrets-key-not-for-production";

bootstrap({
  env: { ...process.env, NODE_ENV: "test", DATABASE_URL: ":memory:" },
  config: { jobs: { enabled: false }, logging: { level: "silent" } },
  db: createSqliteDb(":memory:", { migrationsFolder: "apps/web/drizzle" }),
  storage: memoryStorage(),
  prettyLogs: false,
});
