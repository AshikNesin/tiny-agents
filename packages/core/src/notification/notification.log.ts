/**
 * The notification log (`NotificationLog`): one metadata row per accepted
 * notification — event, title, path, status — never the message body.
 */
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@groot/core/database";
import { notificationLog } from "./notification.schema";

export type NotificationStatus = "queued" | "sent" | "failed" | "suppressed" | "cancelled";

export interface NotificationLogRow {
  id: string;
  event: string;
  category: string;
  channel: string;
  dedupeKey: string;
  botId: string | null;
  title: string;
  url: string | null;
  priority: number;
  status: string;
  reason: string | null;
  providerId: string | null;
  attempts: number;
  createdAt: Date;
  sentAt: Date | null;
}

export type NewLogRow = Pick<
  NotificationLogRow,
  "event" | "category" | "channel" | "dedupeKey" | "title" | "priority" | "status"
> &
  Partial<Pick<NotificationLogRow, "botId" | "url" | "reason">>;

export type LogUpdate = Partial<
  Pick<NotificationLogRow, "status" | "reason" | "providerId" | "attempts" | "sentAt" | "title">
>;

export interface NotificationLogStore {
  create(row: NewLogRow): Promise<string>;
  update(ids: readonly string[], update: LogUpdate): Promise<void>;
  /** A queued or sent row with this key created at or after `since`. */
  hasRecent(dedupeKey: string, since: Date): Promise<boolean>;
  list(limit: number): Promise<NotificationLogRow[]>;
  /** Delete rows created before `before`; returns how many. */
  prune(before: Date): Promise<number>;
}

/** The log on the app database (core's query builder: no relational queries, no transactions). */
export function createDbLogStore(): NotificationLogStore {
  return {
    async create(row) {
      const [created] = await db
        .insert(notificationLog)
        .values(row)
        .returning({ id: notificationLog.id });
      return created!.id;
    },
    async update(ids, update) {
      if (ids.length === 0) return;
      // Drizzle skips undefined fields and refuses an empty SET; nothing to change is a no-op.
      if (Object.values(update).every((value) => value === undefined)) return;
      await db
        .update(notificationLog)
        .set(update)
        .where(inArray(notificationLog.id, [...ids]));
    },
    async hasRecent(dedupeKey, since) {
      const [row] = await db
        .select({ id: notificationLog.id })
        .from(notificationLog)
        .where(
          and(
            eq(notificationLog.dedupeKey, dedupeKey),
            gte(notificationLog.createdAt, since),
            inArray(notificationLog.status, ["queued", "sent"]),
          ),
        )
        .limit(1);
      return row !== undefined;
    },
    list(limit) {
      return db
        .select()
        .from(notificationLog)
        .orderBy(desc(notificationLog.createdAt))
        .limit(limit);
    },
    async prune(before) {
      const deleted = await db
        .delete(notificationLog)
        .where(lt(notificationLog.createdAt, before))
        .returning({ id: notificationLog.id });
      return deleted.length;
    },
  };
}

/** An in-memory store (tests, or a database that is not migrated yet). */
export function createMemoryLogStore(): NotificationLogStore & { rows: NotificationLogRow[] } {
  const rows: NotificationLogRow[] = [];
  let next = 0;
  return {
    rows,
    async create(row) {
      next += 1;
      const id = `log-${next}`;
      rows.push({
        id,
        botId: null,
        url: null,
        reason: null,
        providerId: null,
        attempts: 0,
        createdAt: new Date(),
        sentAt: null,
        ...row,
      });
      return id;
    },
    async update(ids, update) {
      for (const row of rows) if (ids.includes(row.id)) Object.assign(row, update);
    },
    async hasRecent(dedupeKey, since) {
      return rows.some(
        (row) =>
          row.dedupeKey === dedupeKey &&
          row.createdAt >= since &&
          (row.status === "queued" || row.status === "sent"),
      );
    },
    async list(limit) {
      return [...rows]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },
    async prune(before) {
      const keep = rows.filter((row) => row.createdAt >= before);
      const removed = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return removed;
    },
  };
}
