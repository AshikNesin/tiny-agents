/**
 * The Bot list (GLOSSARY: Bot list): what the sidebar shows for each bot and
 * where its denormalised fields come from. The `bots` row carries the last
 * message preview, the last activity time and the owner's read marker; the
 * runtime adds what is live (replying, approvals and Questions waiting).
 *
 * One preview function serves both writers: an owner's send and a Finished
 * reply. Replies reach the row through `botListStep`, a step of the settled
 * pipeline (bots.settled.ts), which reads the Turn's last message from the
 * shared transcript read.
 */
import { desc, eq } from "drizzle-orm";
import {
  isSkipReply,
  stripPeerEnvelope,
  type AgentRuntime,
  type AttachmentRef,
} from "@tiny-agents/agent";
import { db, bots } from "../../db";
import { guestReadMarkers, type Viewer } from "../people/people.service";
import type { BotRow } from "./bots.conversation";
import type { SettledStep } from "./bots.settled";
import type { BotListEntry } from "../../../shared/bot-list";

/** Shape returned by the bots list (the wire contract the client reads, `shared/bot-list.ts`). */
export type { BotListEntry };

export type BotListRuntime = Pick<
  AgentRuntime,
  "busyConversations" | "pendingApprovals" | "pendingQuestions"
>;

/** Longest preview stored on the row. */
export const PREVIEW_CHARS = 120;

/** Unread = an assistant reply newer than the user's last read marker. */
export function isUnread(
  bot: Pick<BotRow, "lastReadAt" | "lastActivityAt" | "lastMessagePreview">,
): boolean {
  if (!bot.lastMessagePreview) return false;
  return bot.lastReadAt === null || bot.lastActivityAt > bot.lastReadAt;
}

export function toListEntry(
  bot: BotRow,
  replying: boolean,
  waiting: { approvals: number; questions: number },
): BotListEntry {
  return {
    id: bot.id,
    conversationId: bot.conversationId,
    name: bot.name,
    description: bot.description,
    modelId: bot.modelId,
    lastMessagePreview: bot.lastMessagePreview,
    lastActivityAt: bot.lastActivityAt,
    lastReadAt: bot.lastReadAt,
    unread: isUnread(bot),
    replying,
    ...waiting,
    pinnedAt: bot.pinnedAt,
  };
}

/**
 * The list preview of a message: its text on one line, cut to PREVIEW_CHARS;
 * for a send with nothing but attachments, a hint of what was attached
 * (issue #17). Cross-bot deliveries carry an attribution envelope (relay,
 * message_bot, mention); the preview shows the payload, as the transcript
 * card does.
 */
export function previewText(text: string, attachments?: AttachmentRef[]): string {
  const trimmed = stripPeerEnvelope(text).replace(/\s+/g, " ").trim();
  if (trimmed) return trimmed.slice(0, PREVIEW_CHARS);
  if (!attachments?.length) return "";
  const first = attachments[0];
  const hint =
    first.kind === "image"
      ? `[Image] ${attachments.filter((a) => a.kind === "image").length > 1 ? `+${attachments.length - 1} more` : first.name}`
      : `[File] ${first.name}`;
  return hint.slice(0, PREVIEW_CHARS);
}

export async function listBots(rt: BotListRuntime, viewer?: Viewer): Promise<BotListEntry[]> {
  const all = await db.select().from(bots).orderBy(desc(bots.lastActivityAt));
  // A guest sees the bots shared with them, read against their own marker (issue #145).
  const markers = viewer?.guest ? await guestReadMarkers(viewer.userId) : undefined;
  const rows = markers
    ? all
        .filter((bot) => markers.has(bot.id))
        .map((bot) => ({ ...bot, lastReadAt: markers.get(bot.id) ?? null }))
    : all;
  const busy = new Set(rt.busyConversations());
  return rows.map((bot) => {
    const ref = Number(bot.conversationId);
    return toListEntry(bot, busy.has(ref), {
      approvals: rt.pendingApprovals(ref),
      questions: rt.pendingQuestions(ref),
    });
  });
}

/**
 * Fold a reply into the row's list fields. A conversation no bot row names
 * (a routine's, a Past chat's) updates nothing. Best effort: the fields
 * catch up on the next reply.
 */
export async function recordReply(
  conversationId: string,
  last: { role: "user" | "assistant"; text: string; createdAt: number } | undefined,
): Promise<void> {
  if (!last) return;
  const preview = previewText(last.text);
  try {
    await db
      .update(bots)
      .set({ lastMessagePreview: preview || null, lastActivityAt: new Date(last.createdAt) })
      .where(eq(bots.conversationId, conversationId));
  } catch {
    // Best effort, as before: the list fields catch up on the next reply.
  }
}

/**
 * The settled step: the Turn that just finished reaches the Bot list. Reads
 * the last assistant message from the shared transcript read; a reply that
 * ended in a model error shows as one, the way the transcript renders it.
 */
export function botListStep(): SettledStep {
  return {
    name: "bot list",
    async run({ conversationId, chat }) {
      const state = await chat();
      const last = state.messages.findLast((message) => message.role === "assistant");
      if (!last || last.status === "streaming") return;
      // A shared chat's silent reply (issue #145) changes nothing in the list.
      if (isSkipReply(last)) return;
      const text = last.status === "error" ? `⚠ ${last.error || "Model error"}` : last.text;
      await recordReply(String(conversationId), {
        role: "assistant",
        text,
        createdAt: last.createdAt,
      });
    },
  };
}
