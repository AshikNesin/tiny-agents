import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export function resolveSqlitePath(url: string): string {
  if (url === ":memory:" || url === "file::memory:") return ":memory:";
  const stripped = url.replace(/^file:/, "");
  return isAbsolute(stripped) ? stripped : resolve(process.cwd(), stripped);
}

export interface CreateSqliteDbOptions {
  migrationsFolder?: string;
}

export function createSqliteDb(url: string, options: CreateSqliteDbOptions = {}) {
  const file = resolveSqlitePath(url);
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });

  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite);
  if (options.migrationsFolder) {
    if (!existsSync(options.migrationsFolder)) {
      throw new Error(`Migrations folder not found: ${options.migrationsFolder}`);
    }
    migrate(db, { migrationsFolder: options.migrationsFolder });
  }
  return db;
}

export type SqliteDb = ReturnType<typeof createSqliteDb>;
