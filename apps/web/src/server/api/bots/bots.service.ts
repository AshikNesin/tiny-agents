/**
 * Bot CRUD + chat actions over Prisma. Everything that touches a bot's
 * durable conversation (create, reconcile, submit) goes through
 * `bots.conversation.ts`; this module adds the row bookkeeping around it.
 */
import { prisma } from "@groot/core/database";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import {
  AgentRuntime,
  ApprovalNotPendingError,
  InvalidAnswersError,
  QuestionNotPendingError,
  closeBrowserSession,
  closeBrowserTab,
  sanitizePeerText,
  stripPeerEnvelope,
  type AttachmentRef,
  type OwnerAnswer,
} from "@tiny-agents/agent";
import { getAgentRuntime } from "./bots.runtime";
import { browserTargetForBot } from "./browser.targets";
import {
  findBotRow,
  startBotConversation,
  submitToBot,
  reconcileBotConversation,
  toBot,
  type Bot,
  type BotRow,
} from "./bots.conversation";
import type { CreateBotDTO, UpdateBotDTO } from "./bots.schema";

export type BotAgentRuntime = Pick<
  AgentRuntime,
  | "createConversation"
  | "configure"
  | "submit"
  | "abort"
  | "withdraw"
  | "hasModel"
  | "listModels"
  | "busyConversations"
  | "listCapabilities"
  | "pendingApprovals"
  | "decideApproval"
  | "pendingQuestions"
  | "answerQuestions"
  | "dismissQuestions"
>;

function runtime(): BotAgentRuntime {
  return getAgentRuntime();
}

/** Shape returned by the bots list: denormalised preview fields + unread. */
export interface BotListEntry {
  id: string;
  conversationId: string;
  name: string;
  description: string;
  modelId: string;
  lastMessagePreview: string | null;
  lastActivityAt: Date;
  /** Pre-open read marker; the client opens at the first message after it. */
  lastReadAt: Date | null;
  unread: boolean;
  replying: boolean;
  /** Tool calls waiting for the owner's approval. */
  approvals: number;
  /** Questions (ask_owner calls) waiting for the owner's answers. */
  questions: number;
  pinnedAt: Date | null;
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
  return bots.map((bot) => {
    const ref = Number(bot.conversationId);
    return toListEntry(bot, busy.has(ref), {
      approvals: rt.pendingApprovals(ref),
      questions: rt.pendingQuestions(ref),
    });
  });
}

export async function getBot(id: string): Promise<Bot> {
  return toBot(await findBotRow(id));
}

/** Names compare case-insensitively after trimming: "  echo " is "Echo". */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Bot names are unique (issue #80): an @mention, a message_bot `to` and the
 * pickers all tell bots apart by name. 409 when another bot has it; `selfId`
 * lets a bot keep its own name or change only its case. Compared in JS, not
 * SQL: SQLite has no case-insensitive `mode`, and the roster is small.
 */
async function assertNameFree(name: string, selfId?: string): Promise<void> {
  const rows = await prisma.bot.findMany({ select: { id: true, name: true } });
  const taken = rows.find((row) => row.id !== selfId && nameKey(row.name) === nameKey(name));
  if (taken) throw Boom.conflict(`A bot named "${taken.name}" already exists`);
}

export async function createBot(data: CreateBotDTO, rt: BotAgentRuntime = runtime()) {
  if (!rt.hasModel(data.modelId)) {
    throw Boom.badRequest(`Unknown model "${data.modelId}"`);
  }
  // Before the conversation exists, so a refused name leaves nothing behind.
  await assertNameFree(data.name);
  const toolPermissions = data.toolPermissions ?? {};
  const conversationId = await startBotConversation(
    {
      modelId: data.modelId,
      systemPrompt: data.systemPrompt,
      toolPermissions,
      autoReview: data.autoReview,
    },
    rt,
  );
  // If the row insert fails the durable conversation is left orphaned — the
  // same end state as bot deletion, which Phase 2 cleanup will sweep.
  const row = await prisma.bot.create({
    data: {
      name: data.name,
      description: data.description,
      systemPrompt: data.systemPrompt,
      modelId: data.modelId,
      conversationId,
      chatStartedAt: new Date(),
      toolPermissions: JSON.stringify(toolPermissions),
      ...(data.memoryEnabled !== undefined ? { memoryEnabled: data.memoryEnabled } : {}),
      ...(data.autoReview !== undefined ? { autoReview: data.autoReview } : {}),
      ...(data.browserProfile !== undefined ? { browserProfile: data.browserProfile } : {}),
    },
  });
  if (data.skillIds || data.connectionIds) {
    await setLinks(row.id, data.skillIds, data.connectionIds);
    return reconcileBotConversation(row.id, rt);
  }
  return getBot(row.id);
}

/** Replace a bot's skill and/or connection assignments (unknown ids are ignored). */
async function setLinks(botId: string, skillIds?: string[], connectionIds?: string[]) {
  if (skillIds) {
    const skills = await prisma.skill.findMany({
      where: { id: { in: skillIds } },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.botSkill.deleteMany({ where: { botId } }),
      prisma.botSkill.createMany({ data: skills.map((skill) => ({ botId, skillId: skill.id })) }),
    ]);
  }
  if (connectionIds) {
    const connections = await prisma.connection.findMany({
      where: { id: { in: connectionIds } },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.botConnection.deleteMany({ where: { botId } }),
      prisma.botConnection.createMany({
        data: connections.map((connection) => ({ botId, connectionId: connection.id })),
      }),
    ]);
  }
}

export async function updateBot(id: string, data: UpdateBotDTO, rt: BotAgentRuntime = runtime()) {
  const before = await findBotRow(id);
  // Turning memory back on starts capture from now: what was said while it
  // was off is never remembered.
  const memoryResumed = data.memoryEnabled === true && !before.memoryEnabled;
  if (data.modelId !== undefined && !rt.hasModel(data.modelId)) {
    throw Boom.badRequest(`Unknown model "${data.modelId}"`);
  }
  if (data.name !== undefined) await assertNameFree(data.name, id);
  await setLinks(id, data.skillIds, data.connectionIds);
  await prisma.bot.update({
    where: { id },
    data: {
      ...(data.toolPermissions !== undefined
        ? { toolPermissions: JSON.stringify(data.toolPermissions) }
        : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.systemPrompt !== undefined ? { systemPrompt: data.systemPrompt } : {}),
      ...(data.modelId !== undefined ? { modelId: data.modelId } : {}),
      ...(data.memoryEnabled !== undefined ? { memoryEnabled: data.memoryEnabled } : {}),
      ...(memoryResumed ? { memoryCapturedThrough: new Date() } : {}),
      ...(data.autoReview !== undefined ? { autoReview: data.autoReview } : {}),
      ...(data.browserProfile !== undefined ? { browserProfile: data.browserProfile } : {}),
    },
  });
  return reconcileBotConversation(id, rt);
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

/**
 * A deleted bot's browser goes with it (issue #88): its tab in the shared
 * browser closes, and a browser of its own closes with its profile (cookies,
 * logins) wiped. Best effort: a browser hiccup never fails the delete.
 */
async function releaseBrowser(bot: { id: string; browserProfile: string }): Promise<void> {
  const target = browserTargetForBot(bot);
  try {
    if (bot.browserProfile === "own") await closeBrowserSession(target, { wipeProfile: true });
    else await closeBrowserTab(target);
  } catch (error) {
    logger.warn({ error, botId: bot.id }, "Failed to close a deleted bot's browser");
  }
}

export async function deleteBot(id: string, rt: BotAgentRuntime = runtime()) {
  const bot = await findBotRow(id);
  // Its routines go with it (cascade), and their conversations (issue #63).
  const routines = await prisma.routine.findMany({
    where: { botId: bot.id, conversationId: { not: null } },
    select: { conversationId: true },
  });
  // The durable conversation's history stays orphaned in agent.db (PRD §5.1;
  // Phase 2 adds cleanup), but its in-flight work stops once the row is gone.
  const deleted = await prisma.bot.delete({ where: { id: bot.id } });
  await retireConversation(rt, bot.conversationId);
  await Promise.all(routines.map((routine) => retireConversation(rt, routine.conversationId!)));
  await releaseBrowser(bot);
  return toBot(deleted);
}

export async function sendMessage(
  id: string,
  input: {
    requestId: string;
    text: string;
    mentions?: string[];
    attachments?: string[];
    whenBusy?: "steer" | "followUp";
  },
  rt: BotAgentRuntime = runtime(),
) {
  const { bot, attachments } = await submitToBot(
    id,
    {
      requestId: input.requestId,
      text: input.text,
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(input.whenBusy ? { whenBusy: input.whenBusy } : {}),
    },
    rt,
  );
  await prisma.bot.update({
    where: { id },
    data: {
      lastActivityAt: new Date(),
      lastMessagePreview: previewOf(input.text, attachments).slice(0, 120),
    },
  });
  if (input.mentions && input.mentions.length > 0) {
    await deliverMentions(bot, input, rt);
  }
  // Questions the bot is waiting on block its reply, so the message would
  // only queue behind them: writing in the chat instead dismisses them, and
  // the bot reads the message right after (a steer joins the same reply).
  const ref = Number(bot.conversationId);
  if (rt.pendingQuestions(ref) > 0) {
    await rt.dismissQuestions(ref).catch((error: unknown) => {
      logger.warn({ error, botId: id }, "Failed to dismiss questions after an owner message");
    });
  }
}

/** Bot-list preview: text, else a hint of what was attached (issue #17). */
function previewOf(text: string, attachments: AttachmentRef[] | undefined): string {
  // Cross-bot deliveries carry system attribution prefixes (relay, message_bot,
  // mention). The list preview shows the payload, like the transcript does.
  const trimmed = stripPeerEnvelope(text).replace(/\s+/g, " ").trim();
  if (trimmed) return trimmed;
  if (!attachments?.length) return "";
  const first = attachments[0];
  return first.kind === "image"
    ? `[Image] ${attachments.filter((a) => a.kind === "image").length > 1 ? `+${attachments.length - 1} more` : first.name}`
    : `[File] ${first.name}`;
}

/** The text a tagged bot receives: enough context to answer in-place. */
function mentionText(ownerContext: string, text: string): string {
  return `${ownerContext} ${text}`;
}

/**
 * Deliver a copy of the message to every @mentioned bot (issue #12). Each
 * delivery is a ledger row (kind="mention") whose answer relays back into
 * the host bot's conversation. Failures never fail the owner's send: the
 * host conversation already got the message.
 */
async function deliverMentions(
  host: Bot,
  input: { requestId: string; text: string; mentions?: string[] },
  rt: BotAgentRuntime,
): Promise<void> {
  const targets = await prisma.bot.findMany({
    where: { id: { in: input.mentions ?? [] }, NOT: { id: host.id } },
    select: { id: true },
  });
  if (targets.length === 0) return;
  const ownerContext = `[From the owner, in ${host.name}'s chat]`;
  for (const target of targets) {
    const requestId = `mention-${input.requestId}-${target.id}`;
    try {
      const existing = await prisma.botMessage.findUnique({ where: { requestId } });
      if (existing) continue;
      await submitToBot(
        target.id,
        {
          requestId,
          text: mentionText(ownerContext, sanitizePeerText(input.text)),
          peer: { kind: "mention", hostName: host.name },
        },
        rt,
      );
      await prisma.botMessage.create({
        data: {
          fromBotId: null,
          toBotId: target.id,
          replyToBotId: host.id,
          kind: "mention",
          requestId,
          text: input.text,
          deliveredAt: new Date(),
        },
      });
    } catch (error) {
      logger.warn({ error, hostId: host.id, targetId: target.id }, "Mention delivery failed");
    }
  }
}

export async function abortReply(id: string) {
  const bot = await getBot(id);
  await runtime().abort(Number(bot.conversationId));
}

/**
 * Withdraw a message queued behind (or steering into) a busy reply: the x on
 * a queued bubble. Inputs already placed into the running reply, or answered,
 * are refused with 409 — they are part of the conversation.
 */
export async function withdrawMessage(id: string, input: { requestId: string }) {
  const bot = await getBot(id);
  const outcome = await runtime().withdraw(Number(bot.conversationId), input.requestId);
  if (outcome === "not_found") throw Boom.notFound("Message not found");
  if (outcome !== "withdrawn") throw Boom.conflict("Message is no longer queued");
  return { withdrawn: true };
}

export async function resetConversation(id: string, rt: BotAgentRuntime = runtime()) {
  const old = await findBotRow(id);
  // Fresh conversation; the old one stays in agent.db, hidden (PRD §5.1),
  // and any reply still running there is stopped.
  const conversationId = await startBotConversation(id, rt);
  await prisma.bot.update({
    where: { id },
    data: {
      conversationId,
      // A fresh thread: routine results from before it stay out of it.
      chatStartedAt: new Date(),
      lastReadAt: new Date(),
      lastMessagePreview: null,
      lastActivityAt: new Date(),
    },
  });
  await retireConversation(rt, old.conversationId);
  return getBot(id);
}

/** Pin or unpin a bot. Row-only: unlike `updateBot` it never reconfigures the conversation. */
export async function setPinned(id: string, pinned: boolean) {
  const row = await findBotRow(id);
  // Re-pinning an already pinned bot keeps its place in the pinned group.
  const pinnedAt = pinned ? (row.pinnedAt ?? new Date()) : null;
  await prisma.bot.update({ where: { id }, data: { pinnedAt } });
  return getBot(id);
}

export async function markRead(id: string) {
  await findBotRow(id);
  await prisma.bot.update({ where: { id }, data: { lastReadAt: new Date() } });
  return getBot(id);
}

/**
 * Answer a tool call waiting for approval. "Always allow" also switches the
 * tool to `allow` for this bot (applies from its next call).
 */
export async function decideApproval(
  id: string,
  input: {
    taskId: number;
    decision: "approved" | "denied";
    alwaysAllow?: string;
    /** Vault cards: also grant the handle for the rest of the conversation. */
    grant?: boolean;
  },
  rt: BotAgentRuntime = runtime(),
) {
  const bot = toBot(await findBotRow(id));
  if (input.decision === "approved" && input.alwaysAllow) {
    const toolPermissions = { ...bot.toolPermissions, [input.alwaysAllow]: "allow" as const };
    await prisma.bot.update({
      where: { id },
      data: { toolPermissions: JSON.stringify(toolPermissions) },
    });
    await reconcileBotConversation(id, rt);
  }
  try {
    const ref = Number(bot.conversationId);
    if (input.grant) await rt.decideApproval(ref, input.taskId, input.decision, { grant: true });
    else await rt.decideApproval(ref, input.taskId, input.decision);
  } catch (error) {
    if (error instanceof ApprovalNotPendingError) throw Boom.conflict(error.message);
    throw error;
  }
}

/**
 * Answer a bot's questions for the owner (one answer per question), or
 * dismiss them with `null`.
 */
export async function answerQuestions(
  id: string,
  input: { taskId: number; answers: OwnerAnswer[] | null },
  rt: BotAgentRuntime = runtime(),
) {
  const bot = await getBot(id);
  try {
    await rt.answerQuestions(Number(bot.conversationId), input.taskId, input.answers);
  } catch (error) {
    if (error instanceof QuestionNotPendingError) throw Boom.conflict(error.message);
    if (error instanceof InvalidAnswersError) throw Boom.badRequest(error.message);
    throw error;
  }
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
  // Cross-bot deliveries land as user turns carrying an attribution prefix
  // (relay, message_bot, mention). The list preview shows the payload, like
  // the transcript card does.
  const payload = last.role === "user" ? stripPeerEnvelope(last.text) : last.text;
  const preview = payload.replace(/\s+/g, " ").trim().slice(0, 120);
  await prisma.bot
    .updateMany({
      where: { conversationId },
      data: { lastMessagePreview: preview || null, lastActivityAt: new Date(last.createdAt) },
    })
    .catch(() => undefined);
}
