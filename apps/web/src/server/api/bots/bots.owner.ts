/**
 * Who is behind a conversation, and behind its current turn. A bot has its
 * chat (`Bot.conversationId`) and one conversation per routine
 * (`Routine.conversationId`, issue #63); a conversation neither names any
 * more was retired by "New chat" (a Past chat) or belongs to a deleted bot.
 *
 * Tool calls know their conversation, not their bot, so every lookup from a
 * conversation to its bot goes through here, and comes back with the bot
 * row's tool-facing fields: callers ask questions, they never join. A
 * routine's turn gets its bot's skills, browser, memories and vault items
 * like the chat does; writes the owner must make themselves (vault uses,
 * memory changes) ask `isUnattended`.
 *
 * This is the app's one reverse lookup from a conversation to its owner
 * (docs/rewrite/README.md §4.4, `Conversations.ownerOf`). Three kinds of
 * query still name `bots.conversationId` directly, on purpose:
 * - writes that must land only while the conversation is still the bot's
 *   chat (`recordReply` in bots.list.ts): the column is their guard;
 * - `followsConversation` (people/access.ts), which the SSE filter needs
 *   synchronous;
 * - set-based joins over many rows (deliveries, routine runs), with their
 *   `coalesce` for legacy rows.
 */
import { eq } from "drizzle-orm";
import type { AgentRuntime } from "@tiny-agents/agent";
import { db, bots, routines } from "../../db";

/** The bot behind a conversation: the fields tool-side callers act on. */
export interface ConversationBot {
  id: string;
  name: string;
  modelId: string | null;
  browserProfile: string;
  /** Memory capture and injection. Off while the bot is shared (issue #145), whatever the row says. */
  memoryEnabled: boolean;
  /** Shared with guests (issue #145): several people write in its chat. */
  shared: boolean;
}

export type ConversationOwner =
  /** The bot's own chat: the owner writes here. */
  | { kind: "chat"; bot: ConversationBot }
  /** One of the bot's routines runs here, unattended (issue #63). */
  | { kind: "routine"; bot: ConversationBot; routineId: string };

const botColumns = {
  id: true,
  name: true,
  modelId: true,
  browserProfile: true,
  memoryEnabled: true,
} as const;

/** One guest is enough to know the bot is shared. */
const sharedWith = { guests: { columns: { userId: true }, limit: 1 } } as const;

function conversationBot(row: {
  id: string;
  name: string;
  modelId: string | null;
  browserProfile: string;
  memoryEnabled: boolean;
  guests: { userId: number }[];
}): ConversationBot {
  const { guests, ...bot } = row;
  const shared = guests.length > 0;
  return { ...bot, memoryEnabled: bot.memoryEnabled && !shared, shared };
}

/** The bot (and routine) behind a conversation; undefined for a retired or deleted one. */
export async function conversationOwner(
  conversation: number | string,
): Promise<ConversationOwner | undefined> {
  const ref = String(conversation);
  const bot = await db.query.bots.findFirst({
    where: eq(bots.conversationId, ref),
    columns: botColumns,
    with: sharedWith,
  });
  if (bot) return { kind: "chat", bot: conversationBot(bot) };
  const routine = await db.query.routines.findFirst({
    where: eq(routines.conversationId, ref),
    columns: { id: true },
    with: { bot: { columns: botColumns, with: sharedWith } },
  });
  return routine
    ? { kind: "routine", bot: conversationBot(routine.bot), routineId: routine.id }
    : undefined;
}

/** The bot whose chat this is; undefined for a routine's, a Past chat or a deleted bot's. */
export async function chatOwner(
  conversation: number | string,
): Promise<ConversationBot | undefined> {
  const owner = await conversationOwner(conversation);
  return owner?.kind === "chat" ? owner.bot : undefined;
}

/** Whether the conversation is a routine's: every turn in it is a routine run. */
export async function isRoutineConversation(conversation: number | string): Promise<boolean> {
  return (await conversationOwner(conversation))?.kind === "routine";
}

export type ChatReader = Pick<AgentRuntime, "readChat">;

/**
 * True when the turn is not the owner's own: a routine run (its own
 * conversation, issue #63) or a peer delivery in the chat (another bot, a
 * relayed reply or a mention), read from the latest user message. Unknown
 * counts as unattended, which only ever refuses more. Pass `owner` when it
 * was already looked up.
 */
export async function isUnattended(
  conversation: number,
  runtime: ChatReader,
  owner?: ConversationOwner | null,
): Promise<boolean> {
  try {
    const resolved = owner === undefined ? await conversationOwner(conversation) : owner;
    if (resolved?.kind === "routine") return true;
    const state = await runtime.readChat(conversation);
    const last = state.messages.findLast((message) => message.role === "user");
    if (!last) return true;
    return last.peer !== undefined;
  } catch {
    return true;
  }
}
