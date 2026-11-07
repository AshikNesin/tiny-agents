/**
 * The Bot list entry (GLOSSARY: Bot list), as `GET /bots` builds it on the
 * server (`bots.list.ts`). The client reads it as `Jsonified<BotListEntry>`:
 * the same fields, with the dates as ISO strings.
 */
export interface BotListEntry {
  id: string;
  conversationId: string;
  name: string;
  description: string;
  /** Null: the bot runs on the default model (Settings → Models). */
  modelId: string | null;
  lastMessagePreview: string | null;
  lastActivityAt: Date;
  /** Pre-open read marker; the client opens at the first message after it. */
  lastReadAt: Date | null;
  unread: boolean;
  replying: boolean;
  /** Tool calls waiting for the owner's approval. */
  approvals: number;
  /** Questions (ask_owner calls) waiting for the owner's answers. */
  questions: number;
  /** When the owner pinned the bot; null when not pinned. */
  pinnedAt: Date | null;
}
