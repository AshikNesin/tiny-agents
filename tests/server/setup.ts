/**
 * Vitest setup for server tests: the app's boot sequence against a fresh
 * in-memory SQLite database per test file (migrations applied) and in-memory
 * file storage. `NODE_ENV=test` disables the job queue, so tests drive
 * `runTick()` explicitly; logs are silent.
 */
import { beforeEach, vi } from "vite-plus/test";
import { bootstrap } from "@groot/core/bootstrap";
import { memoryStorage } from "@groot/core/storage/memory";
import { asCoreDatabase, createAppDb } from "../../apps/web/src/server/db";
import { FIXED_NOW } from "../test-clock";

// Pinned at import as well, so module-scope code in a test file also reads FIXED_NOW.
vi.setSystemTime(FIXED_NOW);
beforeEach(() => {
  vi.setSystemTime(FIXED_NOW);
});

process.env.NODE_ENV = "test";
// Connection-secret encryption needs a key in tests (unset in dev until
// connections with auth are added).
process.env.SECRETS_KEY ??= "test-only-secrets-key-not-for-production";

bootstrap({
  env: { ...process.env, NODE_ENV: "test", DATABASE_URL: ":memory:" },
  config: { jobs: { enabled: false }, logging: { level: "silent" } },
  // The app schema is attached so app code can use relational queries.
  db: asCoreDatabase(createAppDb(":memory:", { migrationsFolder: "apps/web/drizzle" })),
  storage: memoryStorage(),
});
