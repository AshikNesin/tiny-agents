import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
import {
  closeSync,
  cpSync,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { resolveSqlitePath } from "@groot/core/database/node";
import { LOCAL_UPLOADS_ROOT } from "@groot/core/storage/node";
import { createAppDb, sqliteConnection, type AppDatabase } from "./index";
import * as schema from "./schema";

export interface OpenAppDatabaseOptions {
  migrationsFolder: string;
  uploadsRoot?: string;
}

export function openAppDatabase(url: string, options: OpenAppDatabaseOptions): AppDatabase {
  const file = resolveSqlitePath(url);
  if (file !== ":memory:") recoverInterruptedSwap(file);
  if (file !== ":memory:" && existsSync(file) && isLegacyLayout(file)) {
    return copyLegacyDatabase(file, url, options);
  }
  return createAppDb(url, { migrationsFolder: options.migrationsFolder });
}

function recoverInterruptedSwap(file: string): void {
  const dir = path.dirname(file);
  if (existsSync(file) || !existsSync(dir)) return;
  const prefix = path.basename(file);
  const main = (name: string) => !name.endsWith("-wal") && !name.endsWith("-shm");
  const staged = readdirSync(dir)
    .filter((name) => name.startsWith(`${prefix}.migrating-`) && main(name))
    .sort()
    .at(-1);
  if (staged) {
    const staging = path.join(dir, staged);
    renameSync(staging, file);
    for (const suffix of ["-wal", "-shm"]) {
      rmSync(staging + suffix, { force: true });
      rmSync(file + suffix, { force: true });
    }
    syncDirectory(dir);
    logger.warn({ file }, "Completed a database migration a crash had left half-done");
    return;
  }
  const backup = readdirSync(dir)
    .filter((name) => name.startsWith(`${prefix}.prisma-backup-`) && main(name))
    .sort()
    .at(-1);
  if (!backup) return;
  renameSync(path.join(dir, backup), file);
  for (const suffix of ["-wal", "-shm"]) {
    const from = path.join(dir, backup + suffix);
    if (existsSync(from)) renameSync(from, file + suffix);
  }
  syncDirectory(dir);
  logger.warn({ file }, "Restored the pre-migration database a crash had left moved aside");
}

function syncStaged(staging: string): void {
  const fd = openSync(staging, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(path.dirname(staging));
}

function syncDirectory(dir: string): void {
  if (process.platform === "win32") return;
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

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

interface LegacyCopyReport {
  backup: string;
  rows: Record<string, number>;
  kv: number;
  uploadsCopied: boolean;
}

function copyLegacyDatabase(
  file: string,
  url: string,
  options: OpenAppDatabaseOptions,
): AppDatabase & { legacyCopyReport?: LegacyCopyReport } {
  logger.warn({ file }, "Found a pre-Drizzle (Prisma) database; copying it into the new layout");

  const old = new Database(file);
  old.pragma("wal_checkpoint(TRUNCATE)");
  old.close();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${file}.prisma-backup-${stamp}`;
  const staging = `${file}.migrating-${stamp}`;
  for (const name of readdirSync(path.dirname(file))) {
    if (name.startsWith(`${path.basename(file)}.migrating-`)) {
      rmSync(path.join(path.dirname(file), name), { force: true });
    }
  }

  const report: LegacyCopyReport = { backup, rows: {}, kv: 0, uploadsCopied: false };
  const target = createAppDb(`file:${staging}`, { migrationsFolder: options.migrationsFolder });
  const source = new Database(file, { readonly: true, fileMustExist: true });
  try {
    copyRows(source, target, report);
    sqliteConnection(target).pragma("wal_checkpoint(TRUNCATE)");
  } catch (error) {
    source.close();
    sqliteConnection(target).close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(staging + suffix, { force: true });
    logger.error({ error, file }, "Copying the pre-Drizzle database failed; it is left as it was");
    throw error;
  }
  source.close();
  sqliteConnection(target).close();
  syncStaged(staging);

  renameSync(file, backup);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(file + suffix)) renameSync(file + suffix, backup + suffix);
  }
  renameSync(staging, file);
  syncDirectory(path.dirname(file));
  for (const suffix of ["-wal", "-shm"]) rmSync(staging + suffix, { force: true });

  if (options.uploadsRoot) report.uploadsCopied = copyLegacyUploads(options.uploadsRoot);

  logger.warn({ ...report }, "Copied the pre-Drizzle database; the old file is kept as a backup");
  const db = createAppDb(url, { migrationsFolder: options.migrationsFolder });
  return Object.assign(db, { legacyCopyReport: report });
}

function copyRows(source: Database.Database, target: AppDatabase, report: LegacyCopyReport): void {
  const sourceTables = new Set(
    source
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name),
  );
  target.transaction((tx) => {
    for (const table of COPIED_TABLES) {
      const name = getTableName(table);
      if (!sourceTables.has(name)) continue;
      const rows = source.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
      const converted = rows.map((row) => convertRow(table, row));
      if (table === schema.routines) for (const row of converted) row.pendingJobId = null;
      if (table === schema.bots) for (const row of converted) row.modelId = null;
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
}

function convertRow(table: Table, row: Record<string, unknown>): Record<string, unknown> {
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
    const isJson = column.columnType === "SQLiteTextJson" || mode === "json";
    if (mode === "timestamp_ms" || mode === "timestamp") out[field] = toDate(value);
    else if (mode === "boolean") out[field] = toBoolean(value);
    else if (isJson)
      out[field] =
        typeof value === "string" ? parseJson("A legacy JSON column", value, z.unknown()) : value;
    else if (sqlType === "blob")
      out[field] = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    else if (sqlType === "integer")
      out[field] = typeof value === "bigint" ? Number(value) : Number(value);
    else out[field] = value;
  }
  return out;
}

export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "bigint") return new Date(Number(value));
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return new Date(Number(text));
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

const keyvEntrySchema = z.looseObject({
  value: z.unknown().optional(),
  expires: z.number().nullish(),
});

export function convertKeyvEntry(entry: {
  key: string;
  value: string;
}): { key: string; value: string; expiresAt: Date | null } | undefined {
  let parsed: z.infer<typeof keyvEntrySchema>;
  try {
    parsed = keyvEntrySchema.parse(
      JSON.parse(entry.value, (_key, value: unknown) => {
        if (typeof value !== "string" || !value.startsWith(":")) return value;
        if (value.startsWith(":base64:")) return Buffer.from(value.slice(8), "base64");
        return value.slice(1);
      }),
    );
  } catch (error) {
    logger.warn(
      { error, key: entry.key },
      "Skipped a keyv entry the old database stored unreadably",
    );
    return undefined;
  }
  const expires = typeof parsed.expires === "number" ? new Date(parsed.expires) : null;
  if (expires && expires.getTime() <= Date.now()) return undefined;
  const key = entry.key.startsWith("keyv:") ? entry.key.slice("keyv:".length) : entry.key;
  return { key, value: JSON.stringify(parsed.value ?? null), expiresAt: expires };
}

function copyLegacyUploads(uploadsRoot: string): boolean {
  const from = path.resolve(LOCAL_UPLOADS_ROOT);
  const to = path.resolve(uploadsRoot);
  if (from === to || !existsSync(from) || readdirSync(from).length === 0) return false;
  cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
  logger.warn({ from, to }, "Copied uploads from the old local storage folder");
  return true;
}
