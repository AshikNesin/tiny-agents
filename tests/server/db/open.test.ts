/**
 * db/open.ts: the one way a Node process opens the app database. The
 * production path default and the migrations-folder lookup live here, so
 * the server, `pnpm db:migrate` and `pnpm seed` agree.
 */
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  applyDatabaseDefaults,
  findMigrationsFolder,
  PRODUCTION_DATABASE_URL,
} from "../../../apps/web/src/server/db/open";

const saved = process.env.GROOT_MIGRATIONS_DIR;
afterEach(() => {
  if (saved === undefined) delete process.env.GROOT_MIGRATIONS_DIR;
  else process.env.GROOT_MIGRATIONS_DIR = saved;
});

describe("database defaults", () => {
  it("keeps /data/app.db in production when DATABASE_URL is unset, and nothing else", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
    applyDatabaseDefaults(env);
    expect(env.DATABASE_URL).toBe(PRODUCTION_DATABASE_URL);

    const set: NodeJS.ProcessEnv = { NODE_ENV: "production", DATABASE_URL: "file:/x.db" };
    applyDatabaseDefaults(set);
    expect(set.DATABASE_URL).toBe("file:/x.db");

    const dev: NodeJS.ProcessEnv = { NODE_ENV: "development" };
    applyDatabaseDefaults(dev);
    expect(dev.DATABASE_URL).toBeUndefined();
  });
});

describe("migrations folder", () => {
  it("prefers the override, then the bundle's sibling, then the repo folder", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "open-"));
    try {
      delete process.env.GROOT_MIGRATIONS_DIR;
      expect(findMigrationsFolder()).toBe(path.resolve(process.cwd(), "apps/web/drizzle"));

      const beside = path.join(dir, "drizzle");
      mkdirSync(beside);
      expect(findMigrationsFolder(dir)).toBe(beside);

      process.env.GROOT_MIGRATIONS_DIR = dir;
      expect(findMigrationsFolder(dir)).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names every place it looked when none exists", () => {
    process.env.GROOT_MIGRATIONS_DIR = "/nowhere/drizzle";
    const cwd = process.cwd();
    try {
      process.chdir(tmpdir());
      expect(() => findMigrationsFolder()).toThrow(/\/nowhere\/drizzle/);
    } finally {
      process.chdir(cwd);
    }
  });
});
