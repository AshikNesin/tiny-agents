import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createId } from "../utils/id.utils";

/**
 * The notification log (metadata only, never message bodies). Lives in core
 * with the service that writes it; the app schema re-exports it so it shares
 * the app's migration history.
 */
export const notificationLog = sqliteTable(
  "notification_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    /** "approval.requested", "routine.failed", ... */
    event: text("event").notNull(),
    /** needs_input | notify | security | system */
    category: text("category").notNull(),
    /** "pushover" */
    channel: text("channel").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    botId: text("bot_id"),
    /** The rendered (already scrubbed) title. */
    title: text("title").notNull(),
    /** App path only, e.g. /chats/abc. */
    url: text("url"),
    priority: integer("priority").notNull(),
    /** queued | sent | failed | suppressed | cancelled */
    status: text("status").notNull(),
    /** throttled | quiet_hours | disabled | duplicate | over_quota | invalid_credentials | invalid_input | transient */
    reason: text("reason"),
    /** Pushover `request` id. */
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
