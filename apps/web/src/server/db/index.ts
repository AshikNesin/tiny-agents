import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as core from "@groot/core/database";
import { resolveSqlitePath } from "@groot/core/database/node";
import * as schema from "./schema";

/**
 * tiny-agents runs on Node only, so the app works against better-sqlite3 with
 * the full schema attached: relational queries (`db.query.bots.findMany({
 * with: … })`) and synchronous transactions (`db.transaction((tx) => …)`) are
 * available, unlike core's driver-agnostic handle.
 *
 * `createAppDb()` opens the connection; the Node entry and the test setup pass
 * it to `bootstrap()`, so core and the app share one connection. `db` below is
 * the app's typed view of that same handle.
 */
export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface CreateAppDbOptions {
  /** Apply pending Drizzle migrations from this folder on open. */
  migrationsFolder?: string;
}

/** The better-sqlite3 connection behind each instance `createAppDb` made. */
const connections = new WeakMap<AppDatabase, Database.Database>();

/**
 * The raw connection behind an instance, for the few callers that must
 * checkpoint or close it (the legacy copy's staging file). Throws for an
 * instance this module did not open.
 */
export function sqliteConnection(instance: AppDatabase): Database.Database {
  const sqlite = connections.get(instance);
  if (!sqlite) throw new Error("Not a database this module opened");
  return sqlite;
}

export function createAppDb(url: string, options: CreateAppDbOptions = {}): AppDatabase {
  const file = resolveSqlitePath(url);
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });

  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const instance = drizzle(sqlite, { schema });
  connections.set(instance, sqlite);
  if (options.migrationsFolder) {
    if (!existsSync(options.migrationsFolder)) {
      throw new Error(`Migrations folder not found: ${options.migrationsFolder}`);
    }
    migrate(instance, { migrationsFolder: options.migrationsFolder });
  }
  return instance;
}

/**
 * The same connection as core's driver-agnostic `Database`, for `bootstrap()`.
 * The types differ only in the attached schema.
 */
export function asCoreDatabase(instance: AppDatabase): core.Database {
  return instance as unknown as core.Database;
}

/**
 * The shared handle, typed with the app schema. A live view: it forwards to
 * whatever `bootstrap()` installed, so it is safe to import at module top level.
 */
export const db: AppDatabase = new Proxy({} as AppDatabase, {
  get(_target, property) {
    const current = core.db as unknown as AppDatabase | undefined;
    if (!current) throw new Error("Database not initialised: call bootstrap() first");
    const value = Reflect.get(current, property, current) as unknown;
    return typeof value === "function" ? value.bind(current) : value;
  },
});

export * from "./schema";
