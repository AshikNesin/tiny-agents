/**
 * Past chats (issue #101): the conversations a bot ran on before a "New
 * chat". Each is a `BotChat` row naming its retired durable conversation, so
 * the owner can read it (read-only: nothing is submitted or reconciled
 * there), continue it, or delete it. Chats retired before this existed have
 * no link back to their bot and are not listed.
 */
import { prisma } from "@groot/core/database";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { CHAT_WINDOW, pageBefore, windowChat, type AgentRuntime } from "@tiny-agents/agent";
import { chatCards } from "../routines/routines.cards";
import { firstMessageTitle, titlePastChat } from "./chats.title";
import type { ChatHistoryDTO } from "./bots.schema";

export type PastChatRuntime = Pick<AgentRuntime, "readChat">;

/** A past chat as the API returns it. */
export interface PastChat {
  id: string;
  title: string | null;
  startedAt: Date;
  endedAt: Date;
  lastMessagePreview: string | null;
  messageCount: number;
}

const pastChatSelect = {
  id: true,
  title: true,
  startedAt: true,
  endedAt: true,
  lastMessagePreview: true,
  messageCount: true,
} as const;

/** The chat a bot is leaving: its conversation, and the row fields it had. */
export interface EndingChat {
  botId: string;
  botName: string;
  botModelId: string;
  conversationId: string;
  startedAt: Date;
  lastMessagePreview: string | null;
}

/**
 * Record the chat a bot just left as a past chat, then name it in the
 * background. An empty chat is not worth listing and records nothing. Best
 * effort: the bot has already moved on, so a failure is only logged.
 */
export async function recordPastChat(
  ending: EndingChat,
  rt: PastChatRuntime,
  endedAt = new Date(),
): Promise<PastChat | undefined> {
  try {
    const { messages } = await rt.readChat(Number(ending.conversationId));
    const said = messages.filter((m) => m.role === "user" || m.role === "assistant");
    if (said.length === 0) return undefined;
    const chat = await prisma.botChat.upsert({
      where: { conversationId: ending.conversationId },
      create: {
        botId: ending.botId,
        conversationId: ending.conversationId,
        startedAt: ending.startedAt,
        endedAt,
        title: firstMessageTitle(said),
        lastMessagePreview: ending.lastMessagePreview,
        messageCount: said.length,
      },
      update: {},
      select: pastChatSelect,
    });
    void titlePastChat(chat.id, {
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
  return prisma.botChat.findMany({
    where: { botId },
    orderBy: { endedAt: "desc" },
    select: pastChatSelect,
  });
}

/** One of the bot's past chats with its conversation; 404 for another bot's. */
export async function findPastChat(botId: string, chatId: string) {
  const chat = await prisma.botChat.findFirst({
    where: { id: chatId, botId },
    select: { ...pastChatSelect, conversationId: true },
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
export async function readPastChat(botId: string, chatId: string, rt: PastChatRuntime) {
  const chat = await findPastChat(botId, chatId);
  const full = await rt.readChat(Number(chat.conversationId));
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
) {
  const chat = await findPastChat(botId, chatId);
  const { messages } = await rt.readChat(Number(chat.conversationId));
  const page = pageBefore(messages, query.before, query.limit);
  if (!page) throw Boom.badRequest("Unknown message cursor");
  return page;
}

/**
 * Remove a past chat from the bot's history. Its durable conversation stays
 * orphaned in agent.db, like a deleted bot's (PRD §5.1): pi-durable has no
 * conversation delete yet.
 */
export async function deletePastChat(botId: string, chatId: string) {
  const chat = await findPastChat(botId, chatId);
  await prisma.botChat.delete({ where: { id: chat.id } });
  return { deleted: true };
}
