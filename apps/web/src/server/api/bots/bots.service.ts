/**
 * Bot records and the owner's chat actions over Drizzle. Everything that
 * touches a bot's durable conversation (create, reconcile, submit) goes
 * through `bots.conversation.ts`; acting on the chat a bot is on now
 * (read, abort, withdraw, approvals, questions, YOLO) through `bots.chat.ts`;
 * moving between chats through `chats.history.ts`; @mentions through `bots.delivery.ts`; the sidebar's
 * list through `bots.list.ts`. This module adds the row bookkeeping around
 * them. Every action takes the runtime it acts on (`rt`), the test seam.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { AgentRuntime, authoredText, type OwnerAnswer } from "@tiny-agents/agent";
import {
  db,
  botChats,
  botConnections,
  bots,
  botSkills,
  connections,
  promptRevisions,
  routines,
  skills,
} from "../../db";
import { getAgentRuntime } from "./bots.runtime";
import { browserTargetForBot } from "./browser.targets";
import { getBrowserSessions } from "./browser.sessions";
import { computerProfileForBot, getComputerSessions } from "./computer.sessions";
import {
  findBotRow,
  startBotConversation,
  submitToBot,
  reconcileBotConversation,
  toBot,
  type Bot,
} from "./bots.conversation";
import { openBotChat } from "./bots.chat";
import type { ChatHistoryDTO, CreateBotDTO, UpdateBotDTO } from "./bots.schema";
import { findPastChat, leaveChat, retireConversation } from "./chats.history";
import { deliverMentions } from "./bots.delivery";
import { publishBotChatEvent } from "./bots.events";
import { listBots as listBotEntries, previewText } from "./bots.list";
import { authorOf, markGuestRead, setBotGuests, type Viewer } from "../people/people.service";

export type BotAgentRuntime = Pick<
  AgentRuntime,
  | "createConversation"
  | "configure"
  | "submit"
  | "abort"
  | "withdraw"
  | "readChatPage"
  | "readChat"
  | "catalog"
  | "busyConversations"
  | "listCapabilities"
  | "pendingApprovals"
  | "decideApproval"
  | "yolo"
  | "setYolo"
  | "pendingQuestions"
  | "answerQuestions"
  | "dismissQuestions"
  | "isBusy"
>;
/** Kept for the boot wiring until it moves onto `botListStep` (bots.list.ts). */

function runtime(): BotAgentRuntime {
  return getAgentRuntime();
}

/** The sidebar's list: every bot for the owner, the shared ones for a guest (issue #145). */
export async function listBots(rt: BotAgentRuntime = runtime(), viewer?: Viewer) {
  return listBotEntries(rt, viewer);
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
  if (!rt.catalog.has(data.modelId)) {
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
  if (data.skillIds || data.connectionIds || data.guestIds?.length) {
    await setLinks(row.id, data.skillIds, data.connectionIds);
    if (data.guestIds?.length) await setBotGuests(row.id, data.guestIds);
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
  if (data.modelId !== undefined && !rt.catalog.has(data.modelId)) {
    throw Boom.badRequest(`Unknown model "${data.modelId}"`);
  }
  if (data.name !== undefined) await assertNameFree(data.name, id);
  await setLinks(id, data.skillIds, data.connectionIds);
  if (data.guestIds !== undefined) await setBotGuests(id, data.guestIds);
  // A manual prompt edit lands in revision history too, so `update_instructions`
  // changes and owner edits share one log (self-improvement).
  if (data.systemPrompt !== undefined && data.systemPrompt !== before.systemPrompt) {
    await db
      .insert(promptRevisions)
      .values({ botId: id, prompt: data.systemPrompt, source: "manual" });
  }
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
  const changes = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  ) as Partial<typeof bots.$inferInsert>;
  if (Object.keys(changes).length === 0) {
    // Nothing to change (e.g. a PATCH of links only): Prisma treated an empty
    // update as a no-op, while Drizzle refuses an empty SET. Still a 404 when
    // the row is gone.
    const row = await db.query.bots.findFirst({ where: eq(bots.id, id), columns: { id: true } });
    if (!row) throw Boom.notFound("Record not found");
    return;
  }
  const [updated] = await db
    .update(bots)
    .set(changes)
    .where(eq(bots.id, id))
    .returning({ id: bots.id });
  if (!updated) throw Boom.notFound("Record not found");
}

/**
 * A deleted bot's browser goes with it (issue #88): its tab in the shared
 * browser closes, and a browser of its own closes with its profile (cookies,
 * logins) wiped. Best effort: a browser hiccup never fails the delete.
 */
async function releaseBrowser(bot: { id: string; browserProfile: string }): Promise<void> {
  const target = browserTargetForBot(bot);
  try {
    const sessions = getBrowserSessions();
    if (bot.browserProfile === "own") await sessions.close(target, { wipeProfile: true });
    else await sessions.closeTab(target);
  } catch (error) {
    logger.warn({ error, botId: bot.id }, "Failed to close a deleted bot's browser");
  }
}

/**
 * A deleted bot's own desktop goes with it, like its own browser: otherwise
 * Xtigervnc and XFCE ran on until the idle close, its profile stayed on the
 * sandbox, and /computer no longer listed it, so nobody could reset it. A
 * shared desktop belongs to the other bots on it and is left alone.
 */
async function releaseComputer(bot: { id: string; browserProfile: string }): Promise<void> {
  if (bot.browserProfile !== "own") return;
  const sessions = getComputerSessions();
  if (!sessions) return;
  try {
    await sessions.close(computerProfileForBot(bot), { wipe: true });
  } catch (error) {
    logger.warn({ error, botId: bot.id }, "Failed to close a deleted bot's computer");
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
  await Promise.all([releaseBrowser(bot), releaseComputer(bot)]);
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
  /** The sender. In a shared bot's chat (issue #145) the bot reads their name with the message. */
  senderId?: number,
) {
  const chat = await openBotChat(id, rt);
  const shared = senderId !== undefined && chat.row.guests?.length;
  const author = shared ? await authorOf(senderId) : undefined;
  const text = author ? authoredText(author.name, input.text) : input.text;
  const { bot, attachments } = await submitToBot(
    id,
    {
      requestId: input.requestId,
      text,
      ...(author ? { author } : {}),
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(input.whenBusy ? { whenBusy: input.whenBusy } : {}),
    },
    rt,
  );
  await updateRow(id, {
    lastActivityAt: new Date(),
    lastMessagePreview: previewText(text, attachments),
  });
  if (input.mentions && input.mentions.length > 0) {
    await deliverMentions(bot, input, rt);
  }
  // Questions the bot is waiting on block its reply, so the message would
  // only queue behind them: writing in the chat instead dismisses them, and
  // the bot reads the message right after (a steer joins the same reply).
  await chat.dismissPendingQuestions().catch((error: unknown) => {
    logger.warn({ error, botId: id }, "Failed to dismiss questions after an owner message");
  });
}

/**
 * Transcript messages older than `before` (issue #92): the chat stream sends
 * only the newest ones, and the client loads the rest as the owner scrolls up.
 */
export async function chatHistory(
  id: string,
  query: ChatHistoryDTO,
  rt: BotAgentRuntime = runtime(),
) {
  return (await openBotChat(id, rt)).page(query);
}

export async function abortReply(id: string, rt: BotAgentRuntime = runtime()) {
  await (await openBotChat(id, rt)).abort();
}

/**
 * Withdraw a message queued behind (or steering into) a busy reply: the x on
 * a queued bubble. Inputs already placed into the running reply, or answered,
 * are refused with 409 — they are part of the conversation.
 */
export async function withdrawMessage(
  id: string,
  input: { requestId: string },
  rt: BotAgentRuntime = runtime(),
) {
  return (await openBotChat(id, rt)).withdraw(input.requestId);
}

export async function resetConversation(id: string, rt: BotAgentRuntime = runtime()) {
  const old = await findBotRow(id);
  // Fresh conversation; the old one stays in agent.db as a Past chat
  // (issue #101), and any reply still running there is stopped.
  const conversationId = await startBotConversation(id, rt);
  await leaveChat(
    old,
    () =>
      updateRow(id, {
        conversationId,
        // A fresh thread: routine results from before it stay out of it.
        chatStartedAt: new Date(),
        lastReadAt: new Date(),
        lastMessagePreview: null,
        lastActivityAt: new Date(),
      }),
    rt,
  );
  return getBot(id);
}

/**
 * Continue a Past chat (issue #101): the bot moves back onto its
 * conversation, and the chat it was on becomes a Past chat in turn. The
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
  await leaveChat(
    old,
    () => {
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
    },
    rt,
  );
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

/** Mark the chat read: the owner's marker is on the row, a guest's on their share. */
export async function markRead(id: string, viewer?: Viewer) {
  await findBotRow(id);
  if (viewer?.guest) await markGuestRead(id, viewer.userId);
  else await updateRow(id, { lastReadAt: new Date() });
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
  viewer?: Viewer,
) {
  const chat = await openBotChat(id, rt);
  const { bot } = chat;
  if (viewer?.guest) {
    // A guest answers the bot's approvals, but the vault holds the owner's
    // secrets and "always allow" changes the bot: both stay the owner's.
    if (input.alwaysAllow || input.grant) throw Boom.forbidden("Only the owner can do that");
    const call = (await chat.read()).messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.taskId === input.taskId);
    if (call?.vault) throw Boom.forbidden("Only the owner can approve vault use");
  }
  if (input.decision === "approved" && input.alwaysAllow) {
    const toolPermissions = { ...bot.toolPermissions, [input.alwaysAllow]: "allow" as const };
    await updateRow(id, { toolPermissions: JSON.stringify(toolPermissions) });
    await reconcileBotConversation(id, rt);
  }
  await chat.decideApproval(input.taskId, input.decision, { grant: input.grant });
}

// ── YOLO mode (issue #151) ──────────────────────────────────────────────

/**
 * Switch YOLO mode for the bot's current chat: every tool call that would
 * ask runs without a card, except vault uses and turns another bot or a
 * guest started. Owner only (the route is not open to guests). Switching it
 * on also approves the cards already waiting that it would have run.
 */
export async function setYolo(
  id: string,
  on: boolean,
  ownerId: number,
  rt: BotAgentRuntime = runtime(),
): Promise<{ on: boolean; approved: number[] }> {
  const chat = await openBotChat(id, rt);
  const result = await chat.setYolo(on, ownerId);
  publishBotChatEvent(chat.bot.id, { type: "yolo", on });
  return result;
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
  await (await openBotChat(id, rt)).answerQuestions(input.taskId, input.answers);
}
