import { and, eq } from "drizzle-orm";
import type { AgentRuntime } from "@tiny-agents/agent";
import { db, botMessages, bots, routineRuns, routines } from "../../db";

export interface ConversationBot {
  id: string;
  name: string;
  modelId: string | null;
  browserProfile: string;
  memoryEnabled: boolean;
  shared: boolean;
}

export type ConversationOwner =
  | { kind: "chat"; bot: ConversationBot }
  | { kind: "routine"; bot: ConversationBot; routineId: string }
  | { kind: "delivery"; bot: ConversationBot; deliveryId: string };

const botColumns = {
  id: true,
  name: true,
  modelId: true,
  browserProfile: true,
  memoryEnabled: true,
} as const;

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
  const run = await db.query.routineRuns.findFirst({
    where: eq(routineRuns.conversationId, ref),
    columns: { routineId: true },
  });
  const routine = await db.query.routines.findFirst({
    where: run ? eq(routines.id, run.routineId) : eq(routines.conversationId, ref),
    columns: { id: true },
    with: { bot: { columns: botColumns, with: sharedWith } },
  });
  if (routine) return { kind: "routine", bot: conversationBot(routine.bot), routineId: routine.id };
  const delivery = await db.query.botMessages.findFirst({
    where: and(eq(botMessages.conversationId, ref), eq(botMessages.ownConversation, true)),
    columns: { id: true },
    with: { to: { columns: botColumns, with: sharedWith } },
  });
  return delivery
    ? { kind: "delivery", bot: conversationBot(delivery.to), deliveryId: delivery.id }
    : undefined;
}

export async function chatOwner(
  conversation: number | string,
): Promise<ConversationBot | undefined> {
  const owner = await conversationOwner(conversation);
  return owner?.kind === "chat" ? owner.bot : undefined;
}

export async function isRoutineConversation(conversation: number | string): Promise<boolean> {
  return (await conversationOwner(conversation))?.kind === "routine";
}

export type ChatReader = Pick<AgentRuntime, "readChat">;

export async function isUnattended(
  conversation: number,
  runtime: ChatReader,
  owner?: ConversationOwner | null,
): Promise<boolean> {
  try {
    const resolved = owner === undefined ? await conversationOwner(conversation) : owner;
    if (resolved?.kind === "routine" || resolved?.kind === "delivery") return true;
    const state = await runtime.readChat(conversation);
    const last = state.messages.findLast((message) => message.role === "user");
    if (!last) return true;
    return last.peer !== undefined;
  } catch {
    return true;
  }
}

export type OwnerTurn =
  | { status: "disabled" }
  | { status: "unattended" | "shared" | "owner"; owner: ConversationOwner };

export async function ownerTurnOf(
  conversation: number,
  runtime: () => ChatReader,
): Promise<OwnerTurn> {
  const owner = await conversationOwner(conversation).catch(() => undefined);
  if (!owner) return { status: "disabled" };
  const reader: ChatReader = { readChat: (ref) => runtime().readChat(ref) };
  if (await isUnattended(conversation, reader, owner)) return { status: "unattended", owner };
  if (owner.bot.shared) return { status: "shared", owner };
  return { status: "owner", owner };
}
