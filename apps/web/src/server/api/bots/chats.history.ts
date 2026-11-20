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

export type PastChat = PastChatData;

const pastChatColumns = {
  id: true,
  title: true,
  startedAt: true,
  endedAt: true,
  lastMessagePreview: true,
  messageCount: true,
} as const;

const pastChatFields = {
  id: botChats.id,
  title: botChats.title,
  startedAt: botChats.startedAt,
  endedAt: botChats.endedAt,
  lastMessagePreview: botChats.lastMessagePreview,
  messageCount: botChats.messageCount,
};

interface EndingChat {
  botId: string;
  botName: string;
  botModelId: string | null;
  conversationId: string;
  startedAt: Date;
  lastMessagePreview: string | null;
}

export type ChatRow = Pick<
  BotRow,
  "id" | "name" | "modelId" | "conversationId" | "chatStartedAt" | "lastMessagePreview"
>;

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

async function recordPastChat(
  ending: EndingChat,
  rt: PastChatRuntime,
  endedAt = new Date(),
): Promise<PastChat | undefined> {
  try {
    const { messages } = await rt.readChat(conversationRef(ending.conversationId));
    const said = messages.filter((m) => m.role === "user" || m.role === "assistant");
    if (said.length === 0) return undefined;
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

export async function listPastChats(botId: string): Promise<PastChat[]> {
  return db.query.botChats.findMany({
    where: eq(botChats.botId, botId),
    orderBy: desc(botChats.endedAt),
    columns: pastChatColumns,
  });
}

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

export async function deletePastChat(botId: string, chatId: string): Promise<Deleted> {
  const chat = await findPastChat(botId, chatId);
  await db.delete(botChats).where(eq(botChats.id, chat.id));
  return { deleted: true };
}
