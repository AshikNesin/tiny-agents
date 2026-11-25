import { eq, lt, lte, gt, and, or, isNull, isNotNull, sql } from "drizzle-orm";
import { db, kv as kvTable } from "../database";

export interface KvStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
  add<T = unknown>(key: string, value: T, ttlMs?: number): Promise<boolean>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  take<T = unknown>(key: string): Promise<T | undefined>;
  claim(key: string, intervalMs: number): Promise<boolean>;
  list<T = unknown>(prefix?: string): Promise<Array<{ key: string; value: T }>>;
  clear(prefix?: string): Promise<number>;
}

function keyStartsWith(prefix: string) {
  return sql`substr(${kvTable.key}, 1, length(${prefix})) = ${prefix}`;
}

export function createKvStore(namespace = ""): KvStore {
  const full = (key: string) => `${namespace}${key}`;

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const [row] = await db
        .select()
        .from(kvTable)
        .where(eq(kvTable.key, full(key)))
        .limit(1);
      if (!row) return undefined;
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
        await db
          .delete(kvTable)
          .where(and(eq(kvTable.key, full(key)), eq(kvTable.expiresAt, row.expiresAt)));
        return undefined;
      }
      return JSON.parse(row.value) as T;
    },

    async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
      const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;
      const encoded = JSON.stringify(value);
      await db
        .insert(kvTable)
        .values({ key: full(key), value: encoded, expiresAt })
        .onConflictDoUpdate({ target: kvTable.key, set: { value: encoded, expiresAt } });
    },

    async add<T>(key: string, value: T, ttlMs?: number): Promise<boolean> {
      const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;
      const encoded = JSON.stringify(value);
      const written = await db
        .insert(kvTable)
        .values({ key: full(key), value: encoded, expiresAt })
        .onConflictDoUpdate({
          target: kvTable.key,
          set: { value: encoded, expiresAt },
          setWhere: and(isNotNull(kvTable.expiresAt), lte(kvTable.expiresAt, new Date())),
        })
        .returning({ key: kvTable.key });
      return written.length > 0;
    },

    async has(key: string): Promise<boolean> {
      return (await this.get(key)) !== undefined;
    },

    async delete(key: string): Promise<boolean> {
      const deleted = await db
        .delete(kvTable)
        .where(eq(kvTable.key, full(key)))
        .returning();
      return deleted.length > 0;
    },

    async take<T>(key: string): Promise<T | undefined> {
      const [row] = await db
        .delete(kvTable)
        .where(
          and(
            eq(kvTable.key, full(key)),
            or(isNull(kvTable.expiresAt), gt(kvTable.expiresAt, new Date())),
          ),
        )
        .returning({ value: kvTable.value });
      return row ? (JSON.parse(row.value) as T) : undefined;
    },

    async claim(key: string, intervalMs: number): Promise<boolean> {
      const nowMs = Date.now();
      const value = JSON.stringify(nowMs);
      const expiresAt = new Date(nowMs + intervalMs);
      const claimed = await db
        .insert(kvTable)
        .values({ key: full(key), value, expiresAt })
        .onConflictDoUpdate({
          target: kvTable.key,
          set: { value, expiresAt },
          setWhere: sql`CAST(${kvTable.value} AS INTEGER) <= ${nowMs - intervalMs}`,
        })
        .returning({ key: kvTable.key });
      return claimed.length > 0;
    },

    async list<T>(prefix = ""): Promise<Array<{ key: string; value: T }>> {
      const rows = await db
        .select()
        .from(kvTable)
        .where(keyStartsWith(full(prefix)));
      const now = Date.now();
      return rows
        .filter((row) => !row.expiresAt || row.expiresAt.getTime() > now)
        .map((row) => ({
          key: row.key.slice(namespace.length),
          value: JSON.parse(row.value) as T,
        }));
    },

    async clear(prefix = ""): Promise<number> {
      const deleted = await db
        .delete(kvTable)
        .where(keyStartsWith(full(prefix)))
        .returning();
      return deleted.length;
    },
  };
}

export const kv: KvStore = createKvStore();

export const createNamespaceKv = (namespace: string): KvStore => createKvStore(`${namespace}:`);

export async function purgeExpiredKv(): Promise<number> {
  const deleted = await db
    .delete(kvTable)
    .where(and(isNotNull(kvTable.expiresAt), lt(kvTable.expiresAt, new Date())))
    .returning();
  return deleted.length;
}
