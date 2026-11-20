import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createId } from "../utils/id.utils";

export const notificationLog = sqliteTable(
  "notification_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    event: text("event").notNull(),
    category: text("category").notNull(),
    channel: text("channel").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    botId: text("bot_id"),
    title: text("title").notNull(),
    url: text("url"),
    priority: integer("priority").notNull(),
    status: text("status").notNull(),
    reason: text("reason"),
    providerId: text("provider_id"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("notification_log_dedupe_key_created_at_idx").on(t.dedupeKey, t.createdAt),
    index("notification_log_created_at_idx").on(t.createdAt),
  ],
);

export type NotificationLogRow = typeof notificationLog.$inferSelect;
