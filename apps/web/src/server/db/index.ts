import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as core from "@groot/core/database";
import { resolveSqlitePath } from "@groot/core/database/node";
import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface CreateAppDbOptions {
  migrationsFolder?: string;
}

const connections = new WeakMap<AppDatabase, Database.Database>();

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

export function asCoreDatabase(instance: AppDatabase): core.Database {
  return instance as unknown as core.Database;
}

export const db: AppDatabase = new Proxy({} as AppDatabase, {
  get(_target, property) {
    const current = core.db as unknown as AppDatabase | undefined;
    if (!current) throw new Error("Database not initialised: call bootstrap() first");
    const value = Reflect.get(current, property, current) as unknown;
    return typeof value === "function" ? value.bind(current) : value;
  },
});

export * from "./schema";
