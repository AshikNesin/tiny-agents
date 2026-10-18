/**
 * Bot CRUD + chat actions over Prisma, backed by the AgentRuntime for every
 * durable-conversation side effect (create/configure/submit/abort/reset).
 */
import { prisma } from "@groot/core/database";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { AgentRuntime } from "@tiny-agents/agent";
import { getAgentRuntime } from "./bots.runtime";

/** The `Bot` row as Prisma returns it (model defined in apps/web/prisma). */
export interface BotRow {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string;
  avatarEmoji: string | null;
  avatarColor: string;
  conversationId: string;
  lastReadAt: Date | null;
  lastActivityAt: Date;
  lastMessagePreview: string | null;
  createdAt: Date;
  updatedAt: Date;
}
import type { CreateBotDTO, UpdateBotDTO } from "./bots.schema";

export type BotAgentRuntime = Pick<
  AgentRuntime,
  "createConversation" | "configure" | "submit" | "abort" | "hasModel" | "busyConversations"
>;

function runtime(): BotAgentRuntime {
  return getAgentRuntime();
}

/** Shape returned by the bots list: denormalised preview fields + unread. */
export interface BotListEntry {
  id: string;
  name: string;
  description: string;
  modelId: string;
  avatarEmoji: string | null;
  avatarColor: string;
  lastMessagePreview: string | null;
  lastActivityAt: Date;
  unread: boolean;
  replying: boolean;
}

function toListEntry(bot: BotRow, replying: boolean): BotListEntry {
  return {
    id: bot.id,
    name: bot.name,
    description: bot.description,
    modelId: bot.modelId,
    avatarEmoji: bot.avatarEmoji,
    avatarColor: bot.avatarColor,
    lastMessagePreview: bot.lastMessagePreview,
    lastActivityAt: bot.lastActivityAt,
    unread: isUnread(bot),
    replying,
  };
}

/** Unread = an assistant reply newer than the user's last read marker. */
function isUnread(
  bot: Pick<BotRow, "lastReadAt" | "lastActivityAt" | "lastMessagePreview">,
): boolean {
  if (!bot.lastMessagePreview) return false;
  return bot.lastReadAt === null || bot.lastActivityAt > bot.lastReadAt;
}

export async function listBots(rt: BotAgentRuntime = runtime()) {
  const bots = await prisma.bot.findMany({ orderBy: { lastActivityAt: "desc" } });
  const busy = new Set(rt.busyConversations());
  return bots.map((bot) => toListEntry(bot, busy.has(Number(bot.conversationId))));
}

export async function getBot(id: string) {
  const bot = await prisma.bot.findUnique({ where: { id } });
  if (!bot) throw Boom.notFound("Bot not found");
  return bot;
}

export async function createBot(data: CreateBotDTO, rt: BotAgentRuntime = runtime()) {
  if (!rt.hasModel(data.modelId)) {
    throw Boom.badRequest(`Unknown model "${data.modelId}"`);
  }
  const conversationId = await rt.createConversation({
    modelId: data.modelId,
    systemPrompt: data.systemPrompt,
  });
  // If the row insert fails the durable conversation is left orphaned — the
  // same end state as bot deletion, which Phase 2 cleanup will sweep.
  return prisma.bot.create({
    data: {
      name: data.name,
      description: data.description,
      systemPrompt: data.systemPrompt,
      modelId: data.modelId,
      avatarEmoji: data.avatarEmoji ?? null,
      avatarColor: data.avatarColor,
      conversationId: String(conversationId),
    },
  });
}

export async function updateBot(id: string, data: UpdateBotDTO, rt: BotAgentRuntime = runtime()) {
  const bot = await getBot(id);
  const modelId = data.modelId ?? bot.modelId;
  const systemPrompt = data.systemPrompt ?? bot.systemPrompt;
  if (data.modelId !== undefined && !rt.hasModel(modelId)) {
    throw Boom.badRequest(`Unknown model "${modelId}"`);
  }
  await rt.configure(Number(bot.conversationId), { modelId, systemPrompt });
  return prisma.bot.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(data.modelId !== undefined ? { modelId } : {}),
      ...(data.avatarEmoji !== undefined ? { avatarEmoji: data.avatarEmoji } : {}),
      ...(data.avatarColor !== undefined ? { avatarColor: data.avatarColor } : {}),
    },
  });
}

/**
 * Stop whatever a conversation the app no longer shows is still doing. A run
 * left going there would keep calling the model and its tools (e.g. creating
 * tasks) with nobody watching, and resume after every restart. Best effort:
 * the row change has already happened, so a failure here is only logged.
 */
async function retireConversation(rt: BotAgentRuntime, conversationId: string): Promise<void> {
  try {
    await rt.abort(Number(conversationId));
  } catch (error) {
    logger.warn({ error, conversationId }, "Failed to stop a retired bot conversation");
  }
}

export async function deleteBot(id: string, rt: BotAgentRuntime = runtime()) {
  const bot = await getBot(id);
  // The durable conversation's history stays orphaned in agent.db (PRD §5.1;
  // Phase 2 adds cleanup), but its in-flight work stops once the row is gone.
  const deleted = await prisma.bot.delete({ where: { id: bot.id } });
  await retireConversation(rt, bot.conversationId);
  return deleted;
}

export async function sendMessage(id: string, input: { requestId: string; text: string }) {
  const bot = await getBot(id);
  await runtime().submit(Number(bot.conversationId), input);
  await prisma.bot.update({
    where: { id },
    data: {
      lastActivityAt: new Date(),
      lastMessagePreview: input.text.slice(0, 120),
    },
  });
}

export async function abortReply(id: string) {
  const bot = await getBot(id);
  await runtime().abort(Number(bot.conversationId));
}

export async function resetConversation(id: string, rt: BotAgentRuntime = runtime()) {
  const bot = await getBot(id);
  // Fresh conversation; the old one stays in agent.db, hidden (PRD §5.1),
  // and any reply still running there is stopped.
  const conversationId = await rt.createConversation({
    modelId: bot.modelId,
    systemPrompt: bot.systemPrompt,
  });
  const updated = await prisma.bot.update({
    where: { id },
    data: {
      conversationId: String(conversationId),
      lastReadAt: new Date(),
      lastMessagePreview: null,
      lastActivityAt: new Date(),
    },
  });
  await retireConversation(rt, bot.conversationId);
  return updated;
}

export async function markRead(id: string) {
  await getBot(id);
  return prisma.bot.update({ where: { id }, data: { lastReadAt: new Date() } });
}

/**
 * Fold a completed reply into the bot row's denormalised list fields. Called
 * from the activity feed when a bot stops replying.
 */
export async function recordReply(
  conversationId: string,
  last: { role: "user" | "assistant"; text: string; createdAt: number } | undefined,
) {
  if (!last) return;
  const preview = last.text.replace(/\s+/g, " ").trim().slice(0, 120);
  await prisma.bot
    .updateMany({
      where: { conversationId },
      data: { lastMessagePreview: preview || null, lastActivityAt: new Date(last.createdAt) },
    })
    .catch(() => undefined);
}
