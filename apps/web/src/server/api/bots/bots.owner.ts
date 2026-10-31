/**
 * Who is behind a conversation, and behind its current turn. A bot has its
 * chat (`Bot.conversationId`) and one conversation per routine
 * (`Routine.conversationId`, issue #63). Tool calls know their
 * conversation, not their bot, so every lookup from a conversation to its
 * bot goes through here: a routine's turn gets its bot's skills, browser,
 * memories and vault items like the chat does. Writes the owner must make
 * themselves (vault uses, memory changes) ask `isUnattended`.
 */
import { eq } from "drizzle-orm";
import type { AgentRuntime } from "@tiny-agents/agent";
import { db, bots, routines } from "../../db";

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
  const bot = await db.query.bots.findFirst({
    where: eq(bots.conversationId, ref),
    columns: { id: true },
  });
  if (bot) return { botId: bot.id };
  const routine = await db.query.routines.findFirst({
    where: eq(routines.conversationId, ref),
    columns: { id: true, botId: true },
  });
  return routine ? { botId: routine.botId, routineId: routine.id } : undefined;
}

/** Whether the conversation is a routine's: every turn in it is a routine run. */
export async function isRoutineConversation(conversation: number | string): Promise<boolean> {
  const routine = await db.query.routines.findFirst({
    where: eq(routines.conversationId, String(conversation)),
    columns: { id: true },
  });
  return routine !== undefined;
}

export type ChatReader = Pick<AgentRuntime, "readChat">;

/**
 * True when the turn is not the owner's own: a routine run (its own
 * conversation, issue #63) or a peer delivery in the chat (another bot, a
 * relayed reply or a mention), read from the latest user message. Unknown
 * counts as unattended, which only ever refuses more.
 */
export async function isUnattended(conversation: number, runtime: ChatReader): Promise<boolean> {
  try {
    if (await isRoutineConversation(conversation)) return true;
    const state = await runtime.readChat(conversation);
    const last = state.messages.findLast((message) => message.role === "user");
    if (!last) return true;
    return last.peer !== undefined;
  } catch {
    return true;
  }
}
