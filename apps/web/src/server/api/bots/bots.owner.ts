/**
 * Who is behind a conversation. A bot has its chat (`Bot.conversationId`)
 * and one conversation per routine (`Routine.conversationId`, issue #63).
 * Tool calls know their conversation, not their bot, so every lookup from a
 * conversation to its bot goes through here: a routine's turn gets its
 * bot's skills, browser, memories and vault items like the chat does.
 */
import { prisma } from "@groot/core/database";

export interface ConversationOwner {
  botId: string;
  /** Set when the conversation is a routine's, not the bot's chat. */
  routineId?: string;
}

/** The bot (and routine) behind a conversation; undefined for a retired one. */
export async function conversationOwner(
  conversation: number | string,
): Promise<ConversationOwner | undefined> {
  const ref = String(conversation);
  const bot = await prisma.bot.findUnique({ where: { conversationId: ref }, select: { id: true } });
  if (bot) return { botId: bot.id };
  const routine = await prisma.routine.findUnique({
    where: { conversationId: ref },
    select: { id: true, botId: true },
  });
  return routine ? { botId: routine.botId, routineId: routine.id } : undefined;
}

/** Whether the conversation is a routine's: every turn in it is a routine run. */
export async function isRoutineConversation(conversation: number | string): Promise<boolean> {
  const routine = await prisma.routine.findUnique({
    where: { conversationId: String(conversation) },
    select: { id: true },
  });
  return routine !== null;
}
