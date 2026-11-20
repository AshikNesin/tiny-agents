import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

// biome-ignore lint/suspicious/noExplicitAny: driver result types differ between sync and async drivers
export type Database = BaseSQLiteDatabase<"sync" | "async", any, Record<string, never>>;

export let db: Database;

export function setDb(instance: Database): void {
  db = instance;
}

export * from "./schema";
