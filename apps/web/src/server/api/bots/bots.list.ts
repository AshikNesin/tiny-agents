import { desc, eq } from "drizzle-orm";
import { isSkipReply, type AgentRuntime, type AttachmentRef } from "@tiny-agents/agent";
import { stripPeerEnvelope } from "@tiny-agents/agent/peer-envelope";
import { db, bots } from "../../db";
import type { Viewer } from "../people/access";
import { guestReadMarkers } from "../people/people.service";
import { conversationRef, type BotRow } from "./bots.conversation";
import type { SettledStep } from "./bots.settled";
import type { BotListEntry } from "../../../shared/bot-list";

export type { BotListEntry };

export type BotListRuntime = Pick<
  AgentRuntime,
  "busyConversations" | "pendingApprovals" | "pendingQuestions"
>;

export const PREVIEW_CHARS = 120;

export function isUnread(
  bot: Pick<BotRow, "lastReadAt" | "lastActivityAt" | "lastMessagePreview">,
): boolean {
  if (!bot.lastMessagePreview) return false;
  return bot.lastReadAt === null || bot.lastActivityAt > bot.lastReadAt;
}

function toListEntry(
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
    projectId: bot.projectId,
  };
}

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

export async function listBots(rt: BotListRuntime, viewer: Viewer): Promise<BotListEntry[]> {
  const all = await db.select().from(bots).orderBy(desc(bots.lastActivityAt));
  const markers = viewer.kind === "guest" ? await guestReadMarkers(viewer.userId) : undefined;
  const rows = markers
    ? all
        .filter((bot) => markers.has(bot.id))
        .map((bot) => ({ ...bot, lastReadAt: markers.get(bot.id) ?? null }))
    : all;
  const busy = new Set(rt.busyConversations());
  return rows.map((bot) => {
    const ref = conversationRef(bot.conversationId);
    return toListEntry(bot, busy.has(ref), {
      approvals: rt.pendingApprovals(ref),
      questions: rt.pendingQuestions(ref),
    });
  });
}

async function recordReply(
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
  } catch {}
}

export function botListStep(): SettledStep {
  return {
    name: "bot list",
    async run({ conversationId, chat }) {
      const state = await chat();
      const last = state.messages.findLast((message) => message.role === "assistant");
      if (!last || last.status === "streaming") return;
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
