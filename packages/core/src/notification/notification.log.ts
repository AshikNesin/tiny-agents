/**
 * The notification log (`NotificationLog`): one metadata row per accepted
 * notification — event, title, path, status — never the message body.
 */
import { prisma } from "@groot/core/database";

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

export function createPrismaLogStore(): NotificationLogStore {
  return {
    async create(row) {
      const created = await prisma.notificationLog.create({ data: row, select: { id: true } });
      return created.id;
    },
    async update(ids, update) {
      if (ids.length === 0) return;
      await prisma.notificationLog.updateMany({ where: { id: { in: [...ids] } }, data: update });
    },
    async hasRecent(dedupeKey, since) {
      const row = await prisma.notificationLog.findFirst({
        where: { dedupeKey, createdAt: { gte: since }, status: { in: ["queued", "sent"] } },
        select: { id: true },
      });
      return row !== null;
    },
    list(limit) {
      return prisma.notificationLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    },
    async prune(before) {
      const { count } = await prisma.notificationLog.deleteMany({
        where: { createdAt: { lt: before } },
      });
      return count;
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
