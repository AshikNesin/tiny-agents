/**
 * Bot CRUD + chat actions over Drizzle. Everything that touches a bot's
 * durable conversation (create, reconcile, submit) goes through
 * `bots.conversation.ts`; this module adds the row bookkeeping around it.
 */
import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
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
import {
  db,
  botChats,
  botConnections,
  botMessages,
  bots,
  botSkills,
  connections,
  routines,
  skills,
} from "../../db";
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
import type { ChatHistoryDTO, CreateBotDTO, UpdateBotDTO } from "./bots.schema";
import { findPastChat, recordPastChat, type EndingChat } from "./chats.history";

export type BotAgentRuntime = Pick<
  AgentRuntime,
  | "createConversation"
  | "configure"
  | "submit"
  | "abort"
  | "withdraw"
  | "readChatPage"
  | "readChat"
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
  const rows = await db.select().from(bots).orderBy(desc(bots.lastActivityAt));
  const busy = new Set(rt.busyConversations());
  return rows.map((bot) => {
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
  const rows = await db.select({ id: bots.id, name: bots.name }).from(bots);
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
  const [row] = await db
    .insert(bots)
    .values({
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
    })
    .returning();
  if (!row) throw new Error("Bot insert returned no row");
  if (data.skillIds || data.connectionIds) {
    await setLinks(row.id, data.skillIds, data.connectionIds);
    return reconcileBotConversation(row.id, rt);
  }
  return getBot(row.id);
}

/** Replace a bot's skill and/or connection assignments (unknown ids are ignored). */
async function setLinks(botId: string, skillIds?: string[], connectionIds?: string[]) {
  if (skillIds) {
    const known = await db
      .select({ id: skills.id })
      .from(skills)
      .where(inArray(skills.id, skillIds));
    db.transaction((tx) => {
      tx.delete(botSkills).where(eq(botSkills.botId, botId)).run();
      if (known.length > 0) {
        tx.insert(botSkills)
          .values(known.map((skill) => ({ botId, skillId: skill.id })))
          .run();
      }
    });
  }
  if (connectionIds) {
    const known = await db
      .select({ id: connections.id })
      .from(connections)
      .where(inArray(connections.id, connectionIds));
    db.transaction((tx) => {
      tx.delete(botConnections).where(eq(botConnections.botId, botId)).run();
      if (known.length > 0) {
        tx.insert(botConnections)
          .values(known.map((connection) => ({ botId, connectionId: connection.id })))
          .run();
      }
    });
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
  await updateRow(id, {
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
  });
  return reconcileBotConversation(id, rt);
}

/**
 * Update one bot row. A row that vanished since the caller read it is a 404,
 * as Prisma's `update` reported it (P2025).
 */
async function updateRow(id: string, data: Partial<typeof bots.$inferInsert>): Promise<void> {
  const [updated] = await db
    .update(bots)
    .set(data)
    .where(eq(bots.id, id))
    .returning({ id: bots.id });
  if (!updated) throw Boom.notFound("Record not found");
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
  const routineRows = await db
    .select({ conversationId: routines.conversationId })
    .from(routines)
    .where(and(eq(routines.botId, bot.id), isNotNull(routines.conversationId)));
  // The durable conversation's history stays orphaned in agent.db (PRD §5.1;
  // Phase 2 adds cleanup), but its in-flight work stops once the row is gone.
  const [deleted] = await db.delete(bots).where(eq(bots.id, bot.id)).returning();
  if (!deleted) throw Boom.notFound("Record not found");
  await retireConversation(rt, bot.conversationId);
  await Promise.all(routineRows.map((routine) => retireConversation(rt, routine.conversationId!)));
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
  await updateRow(id, {
    lastActivityAt: new Date(),
    lastMessagePreview: previewOf(input.text, attachments).slice(0, 120),
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
  const targets = await db
    .select({ id: bots.id })
    .from(bots)
    .where(and(inArray(bots.id, input.mentions ?? []), ne(bots.id, host.id)));
  if (targets.length === 0) return;
  const ownerContext = `[From the owner, in ${host.name}'s chat]`;
  for (const target of targets) {
    const requestId = `mention-${input.requestId}-${target.id}`;
    try {
      const existing = await db.query.botMessages.findFirst({
        where: eq(botMessages.requestId, requestId),
        columns: { id: true },
      });
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
      await db.insert(botMessages).values({
        fromBotId: null,
        toBotId: target.id,
        replyToBotId: host.id,
        kind: "mention",
        requestId,
        text: input.text,
        deliveredAt: new Date(),
      });
    } catch (error) {
      logger.warn({ error, hostId: host.id, targetId: target.id }, "Mention delivery failed");
    }
  }
}

/**
 * Transcript messages older than `before` (issue #92): the chat stream sends
 * only the newest ones, and the client loads the rest as the owner scrolls up.
 */
export async function chatHistory(id: string, query: ChatHistoryDTO) {
  const bot = await getBot(id);
  const page = await runtime().readChatPage(Number(bot.conversationId), query);
  if (!page) throw Boom.badRequest("Unknown message cursor");
  return page;
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

/** The chat a bot row is on, as a past chat would record it. */
function endingChat(row: BotRow): EndingChat {
  return {
    botId: row.id,
    botName: row.name,
    botModelId: row.modelId,
    conversationId: row.conversationId,
    startedAt: row.chatStartedAt,
    lastMessagePreview: row.lastMessagePreview,
  };
}

export async function resetConversation(id: string, rt: BotAgentRuntime = runtime()) {
  const old = await findBotRow(id);
  // Fresh conversation; the old one stays in agent.db as a past chat
  // (issue #101), and any reply still running there is stopped.
  const conversationId = await startBotConversation(id, rt);
  await updateRow(id, {
    conversationId,
    // A fresh thread: routine results from before it stay out of it.
    chatStartedAt: new Date(),
    lastReadAt: new Date(),
    lastMessagePreview: null,
    lastActivityAt: new Date(),
  });
  await retireConversation(rt, old.conversationId);
  await recordPastChat(endingChat(old), rt);
  return getBot(id);
}

/**
 * Continue a past chat (issue #101): the bot moves back onto its
 * conversation, and the chat it was on becomes a past chat in turn. The
 * conversation is reconciled first, so it runs on the bot's current persona,
 * model and tools. Its routine cards start from when it first began.
 */
export async function continuePastChat(
  id: string,
  chatId: string,
  rt: BotAgentRuntime = runtime(),
) {
  const old = await findBotRow(id);
  const past = await findPastChat(id, chatId);
  db.transaction((tx) => {
    // Both rows must still be there (Prisma's delete/update threw P2025 otherwise).
    const removed = tx
      .delete(botChats)
      .where(eq(botChats.id, past.id))
      .returning({ id: botChats.id })
      .all();
    if (removed.length === 0) throw Boom.notFound("Record not found");
    const moved = tx
      .update(bots)
      .set({
        conversationId: past.conversationId,
        chatStartedAt: past.startedAt,
        lastReadAt: new Date(),
        lastMessagePreview: past.lastMessagePreview,
        lastActivityAt: new Date(),
      })
      .where(eq(bots.id, id))
      .returning({ id: bots.id })
      .all();
    if (moved.length === 0) throw Boom.notFound("Record not found");
  });
  await retireConversation(rt, old.conversationId);
  await recordPastChat(endingChat(old), rt);
  return reconcileBotConversation(id, rt);
}

/** Pin or unpin a bot. Row-only: unlike `updateBot` it never reconfigures the conversation. */
export async function setPinned(id: string, pinned: boolean) {
  const row = await findBotRow(id);
  // Re-pinning an already pinned bot keeps its place in the pinned group.
  const pinnedAt = pinned ? (row.pinnedAt ?? new Date()) : null;
  await updateRow(id, { pinnedAt });
  return getBot(id);
}

export async function markRead(id: string) {
  await findBotRow(id);
  await updateRow(id, { lastReadAt: new Date() });
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
    await updateRow(id, { toolPermissions: JSON.stringify(toolPermissions) });
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
  try {
    await db
      .update(bots)
      .set({ lastMessagePreview: preview || null, lastActivityAt: new Date(last.createdAt) })
      .where(eq(bots.conversationId, conversationId));
  } catch {
    // Best effort, as before: the list fields catch up on the next reply.
  }
}
