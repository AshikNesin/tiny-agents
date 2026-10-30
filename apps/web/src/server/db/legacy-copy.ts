import { cpSync, existsSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { resolveSqlitePath } from "@groot/core/database/node";
import { LOCAL_UPLOADS_ROOT } from "@groot/core/storage/node";
import { createAppDb, type AppDatabase } from "./index";
import * as schema from "./schema";

/**
 * One-off move from the Prisma database (tiny-agents before groot 3.0) to the
 * Drizzle one, run on the first boot that finds the old layout.
 *
 * The old file is renamed to `<file>.prisma-backup-<timestamp>` and kept; a
 * fresh database is created at the original path from the Drizzle migrations
 * and every app row is copied across. The Prisma models and the Drizzle tables
 * share table names and field names (columns go camelCase → snake_case), so
 * rows map field by field; dates (ISO text in Prisma's SQLite) become
 * millisecond timestamps, booleans and JSON are normalised. Keyv entries move
 * to the `kv` table. The old job queue (honker) is not copied: routines re-arm
 * their next run on boot (`routines.jobs.ts`), and stale job logs are dropped.
 */

export interface OpenAppDatabaseOptions {
  migrationsFolder: string;
  /** Where uploads live now; files still under the old local root are copied here. */
  uploadsRoot?: string;
}

/** Open the app database, first copying a pre-Drizzle database into the new layout. */
export function openAppDatabase(url: string, options: OpenAppDatabaseOptions): AppDatabase {
  const file = resolveSqlitePath(url);
  if (file !== ":memory:" && existsSync(file) && isLegacyLayout(file)) {
    return copyLegacyDatabase(file, url, options);
  }
  return createAppDb(url, { migrationsFolder: options.migrationsFolder });
}

/** Prisma left `_prisma_migrations`; a database Drizzle has migrated has `__drizzle_migrations`. */
export function isLegacyLayout(file: string): boolean {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const names = new Set(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name),
    );
    return names.has("_prisma_migrations") && !names.has("__drizzle_migrations");
  } finally {
    sqlite.close();
  }
}

/** Tables copied as-is (same name, same field names), parents before children. */
const COPIED_TABLES: Table[] = [
  schema.users,
  schema.passkeys,
  schema.bots,
  schema.botChats,
  schema.skills,
  schema.botSkills,
  schema.connections,
  schema.botConnections,
  schema.botMessages,
  schema.tasks,
  schema.vaultItems,
  schema.vaultAuditEvents,
  schema.uploads,
  schema.routines,
  schema.routineRuns,
  schema.memories,
  schema.notificationLog,
];

export interface LegacyCopyReport {
  backup: string;
  rows: Record<string, number>;
  kv: number;
  uploadsCopied: boolean;
}

export function copyLegacyDatabase(
  file: string,
  url: string,
  options: OpenAppDatabaseOptions,
): AppDatabase & { legacyCopyReport?: LegacyCopyReport } {
  logger.warn({ file }, "Found a pre-Drizzle (Prisma) database; copying it into the new layout");

  // Fold the WAL into the main file so the rename carries every committed row.
  const old = new Database(file);
  old.pragma("wal_checkpoint(TRUNCATE)");
  old.close();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${file}.prisma-backup-${stamp}`;
  renameSync(file, backup);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(file + suffix)) renameSync(file + suffix, backup + suffix);
  }

  const db = createAppDb(url, { migrationsFolder: options.migrationsFolder });
  const source = new Database(backup, { readonly: true, fileMustExist: true });
  const report: LegacyCopyReport = { backup, rows: {}, kv: 0, uploadsCopied: false };
  try {
    const sourceTables = new Set(
      source
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name),
    );
    db.transaction((tx) => {
      for (const table of COPIED_TABLES) {
        const name = getTableName(table);
        if (!sourceTables.has(name)) continue;
        const rows = source.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
        const converted = rows.map((row) => convertRow(table, row));
        // Old job ids point at the retired queue; routines re-arm on boot.
        if (table === schema.routines) for (const row of converted) row.pendingJobId = null;
        for (let i = 0; i < converted.length; i += 200) {
          tx.insert(table)
            .values(converted.slice(i, i + 200) as never)
            .run();
        }
        report.rows[name] = converted.length;
      }
      if (sourceTables.has("keyv")) {
        const entries = source.prepare(`SELECT key, value FROM keyv`).all() as {
          key: string;
          value: string;
        }[];
        for (const entry of entries) {
          const kvRow = convertKeyvEntry(entry);
          if (!kvRow) continue;
          tx.insert(schema.kv).values(kvRow).onConflictDoNothing().run();
          report.kv += 1;
        }
      }
    });
  } finally {
    source.close();
  }

  if (options.uploadsRoot) report.uploadsCopied = copyLegacyUploads(options.uploadsRoot);

  logger.warn({ ...report }, "Copied the pre-Drizzle database; the old file is kept as a backup");
  return Object.assign(db, { legacyCopyReport: report });
}

/** Map an old row onto a table's fields, converting each value to the field's mode. */
export function convertRow(table: Table, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(getTableColumns(table))) {
    if (!(field in row)) continue;
    const value = row[field];
    if (value === null || value === undefined) {
      out[field] = null;
      continue;
    }
    const mode = (column as { mode?: string }).mode;
    const sqlType = column.getSQLType().toLowerCase();
    // JSON text columns are their own column type (no `mode`); Drizzle
    // stringifies on insert, so hand them the parsed value.
    const isJson = column.columnType === "SQLiteTextJson" || mode === "json";
    if (mode === "timestamp_ms" || mode === "timestamp") out[field] = toDate(value);
    else if (mode === "boolean") out[field] = toBoolean(value);
    else if (isJson) out[field] = typeof value === "string" ? JSON.parse(value) : value;
    else if (sqlType === "blob")
      out[field] = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    else if (sqlType === "integer")
      out[field] = typeof value === "bigint" ? Number(value) : Number(value);
    else out[field] = value;
  }
  return out;
}

/** Prisma's SQLite adapter wrote ISO text; older rows may hold epoch milliseconds. */
export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "bigint") return new Date(Number(value));
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return new Date(Number(text));
  // "YYYY-MM-DD HH:MM:SS" (SQLite CURRENT_TIMESTAMP) is UTC without a zone.
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const date = new Date(normalised);
  if (Number.isNaN(date.getTime())) throw new Error(`Unreadable date in legacy row: ${text}`);
  return date;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === 1n || value === "1" || value === "true";
}

/**
 * A Keyv row: namespaced keys are `NAMESPACE:key` (exactly what
 * `createNamespaceKv` uses); un-namespaced ones carried Keyv's default
 * `keyv:` prefix. Values are `{ value, expires }` in Keyv's JSON encoding
 * (strings starting with ":" are escaped with a second ":", buffers are
 * ":base64:…"). Expired entries are skipped.
 */
export function convertKeyvEntry(entry: {
  key: string;
  value: string;
}): { key: string; value: string; expiresAt: Date | null } | undefined {
  let parsed: { value?: unknown; expires?: number | null };
  try {
    parsed = JSON.parse(entry.value, (_key, value: unknown) => {
      if (typeof value !== "string" || !value.startsWith(":")) return value;
      if (value.startsWith(":base64:")) return Buffer.from(value.slice(8), "base64");
      return value.slice(1);
    }) as { value?: unknown; expires?: number | null };
  } catch {
    return undefined;
  }
  const expires = typeof parsed.expires === "number" ? new Date(parsed.expires) : null;
  if (expires && expires.getTime() <= Date.now()) return undefined;
  const key = entry.key.startsWith("keyv:") ? entry.key.slice("keyv:".length) : entry.key;
  return { key, value: JSON.stringify(parsed.value ?? null), expiresAt: expires };
}

/**
 * Before groot 3.0 the local storage driver wrote to `./local/uploads`; uploads
 * now live beside the database. Copy anything still in the old folder (files
 * already in the new one win). Returns true when something was copied.
 */
export function copyLegacyUploads(uploadsRoot: string): boolean {
  const from = path.resolve(LOCAL_UPLOADS_ROOT);
  const to = path.resolve(uploadsRoot);
  if (from === to || !existsSync(from) || readdirSync(from).length === 0) return false;
  cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
  logger.warn({ from, to }, "Copied uploads from the old local storage folder");
  return true;
}
