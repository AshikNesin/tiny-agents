/**
 * Past chats (issue #101): the conversations a bot ran on before a "New
 * chat". Each is a `BotChat` row naming its retired durable conversation, so
 * the owner can read it (read-only: nothing is submitted or reconciled
 * there), continue it, or delete it. Chats retired before this existed have
 * no link back to their bot and are not listed.
 *
 * Moving a bot between chats ("New chat", continuing a Past chat) is one
 * operation here, `leaveChat`: the row moves, the chat it left is stopped
 * and recorded, and whoever follows the bot's chat (its open stream) is told.
 */
import { and, desc, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { CHAT_WINDOW, pageBefore, windowChat, type AgentRuntime } from "@tiny-agents/agent";
import { db, botChats } from "../../db";
import { chatCards } from "../routines/routines.cards";
import { firstMessageTitle, titlePastChat } from "./chats.title";
import { publishBotChatEvent } from "./bots.events";
import type { ChatHistoryDTO } from "./bots.schema";
import { conversationRef, type BotRow } from "./bots.conversation";
import type { Deleted } from "../../../shared/api/common";
import type { HistoryPage, PastChatData, PastChatViewData } from "../../../shared/api/bots";

export type PastChatRuntime = Pick<AgentRuntime, "readChat">;
export type LeaveChatRuntime = Pick<AgentRuntime, "readChat" | "abort">;

/** A past chat as the API returns it (`shared/api/bots.ts`). */
export type PastChat = PastChatData;

const pastChatColumns = {
  id: true,
  title: true,
  startedAt: true,
  endedAt: true,
  lastMessagePreview: true,
  messageCount: true,
} as const;

/** The same fields for a core select (`returning`). */
const pastChatFields = {
  id: botChats.id,
  title: botChats.title,
  startedAt: botChats.startedAt,
  endedAt: botChats.endedAt,
  lastMessagePreview: botChats.lastMessagePreview,
  messageCount: botChats.messageCount,
};

/** The chat a bot is leaving: its conversation, and the row fields it had. */
interface EndingChat {
  botId: string;
  botName: string;
  botModelId: string | null;
  conversationId: string;
  startedAt: Date;
  lastMessagePreview: string | null;
}

/** The bot row fields that describe the chat it is on. */
export type ChatRow = Pick<
  BotRow,
  "id" | "name" | "modelId" | "conversationId" | "chatStartedAt" | "lastMessagePreview"
>;

/** The chat a bot row is on, as a Past chat would record it. */
function endingChat(row: ChatRow): EndingChat {
  return {
    botId: row.id,
    botName: row.name,
    botModelId: row.modelId,
    conversationId: row.conversationId,
    startedAt: row.chatStartedAt,
    lastMessagePreview: row.lastMessagePreview,
  };
}

/**
 * Stop whatever a conversation the app no longer shows is still doing. A run
 * left going there would keep calling the model and its tools (e.g. creating
 * tasks) with nobody watching, and resume after every restart. Best effort:
 * the row change has already happened, so a failure here is only logged.
 */
export async function retireConversation(
  rt: Pick<AgentRuntime, "abort">,
  conversationId: string,
): Promise<void> {
  try {
    await rt.abort(conversationRef(conversationId));
  } catch (error) {
    logger.warn({ error, conversationId }, "Failed to stop a retired bot conversation");
  }
}

/**
 * Move a bot off the chat it is on: `moveRow` points the row at the next
 * conversation (a fresh one, or a Past chat's), then the bot's followers
 * are told (`chat-changed`: its open streams end, and the client reconnects
 * onto the new chat), and the chat it left is stopped and recorded as a
 * Past chat.
 */
export async function leaveChat(
  old: ChatRow,
  moveRow: () => Promise<void> | void,
  rt: LeaveChatRuntime,
): Promise<void> {
  await moveRow();
  publishBotChatEvent(old.id, { type: "chat-changed" });
  await retireConversation(rt, old.conversationId);
  await recordPastChat(endingChat(old), rt);
}

/**
 * Record the chat a bot just left as a past chat, then name it in the
 * background. An empty chat is not worth listing and records nothing. Best
 * effort: the bot has already moved on, so a failure is only logged.
 */
async function recordPastChat(
  ending: EndingChat,
  rt: PastChatRuntime,
  endedAt = new Date(),
): Promise<PastChat | undefined> {
  try {
    const { messages } = await rt.readChat(conversationRef(ending.conversationId));
    const said = messages.filter((m) => m.role === "user" || m.role === "assistant");
    if (said.length === 0) return undefined;
    // Recorded once per conversation: an existing row is kept as it is.
    const [created] = await db
      .insert(botChats)
      .values({
        botId: ending.botId,
        conversationId: ending.conversationId,
        startedAt: ending.startedAt,
        endedAt,
        title: firstMessageTitle(said),
        lastMessagePreview: ending.lastMessagePreview,
        messageCount: said.length,
      })
      .onConflictDoNothing({ target: botChats.conversationId })
      .returning(pastChatFields);
    const chat =
      created ??
      (await db.query.botChats.findFirst({
        where: eq(botChats.conversationId, ending.conversationId),
        columns: pastChatColumns,
      }));
    if (!chat) return undefined;
    void titlePastChat(chat.id, {
      botId: ending.botId,
      botName: ending.botName,
      botModelId: ending.botModelId,
      messages: said,
    });
    return chat;
  } catch (error) {
    logger.warn(
      { error, botId: ending.botId, conversationId: ending.conversationId },
      "Failed to record a past chat",
    );
    return undefined;
  }
}

/** A bot's past chats, the most recently ended first. */
export async function listPastChats(botId: string): Promise<PastChat[]> {
  return db.query.botChats.findMany({
    where: eq(botChats.botId, botId),
    orderBy: desc(botChats.endedAt),
    columns: pastChatColumns,
  });
}

/** One of the bot's past chats with its conversation; 404 for another bot's. */
export async function findPastChat(botId: string, chatId: string) {
  const chat = await db.query.botChats.findFirst({
    where: and(eq(botChats.id, chatId), eq(botChats.botId, botId)),
    columns: { ...pastChatColumns, conversationId: true },
  });
  if (!chat) throw Boom.notFound("Past chat not found");
  return chat;
}

function publicChat({ conversationId: _ref, ...chat }: PastChat & { conversationId: string }) {
  return chat;
}

/**
 * A past chat to read: the newest messages windowed like the live stream
 * (older ones page in with `pastChatPage`), and the routine cards that
 * finished while it was the bot's chat. One read, no stream: nothing runs
 * in a retired conversation.
 */
export async function readPastChat(
  botId: string,
  chatId: string,
  rt: PastChatRuntime,
): Promise<PastChatViewData> {
  const chat = await findPastChat(botId, chatId);
  const full = await rt.readChat(conversationRef(chat.conversationId));
  return {
    chat: publicChat(chat),
    state: windowChat(full, CHAT_WINDOW)!,
    runs: await chatCards(botId, chat.startedAt, undefined, chat.endedAt),
  };
}

/** Messages of a past chat older than `before`, oldest first. */
export async function pastChatPage(
  botId: string,
  chatId: string,
  query: ChatHistoryDTO,
  rt: PastChatRuntime,
): Promise<HistoryPage> {
  const chat = await findPastChat(botId, chatId);
  const { messages } = await rt.readChat(conversationRef(chat.conversationId));
  const page = pageBefore(messages, query.before, query.limit);
  if (!page) throw Boom.badRequest("Unknown message cursor");
  return page;
}

/**
 * Remove a past chat from the bot's history. Its durable conversation stays
 * orphaned in agent.db, like a deleted bot's (PRD §5.1): pi-durable has no
 * conversation delete yet.
 */
export async function deletePastChat(botId: string, chatId: string): Promise<Deleted> {
  const chat = await findPastChat(botId, chatId);
  await db.delete(botChats).where(eq(botChats.id, chat.id));
  return { deleted: true };
}
