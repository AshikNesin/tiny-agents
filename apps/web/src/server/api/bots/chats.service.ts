/**
 * The owner's chat actions over Drizzle: send (steering or queued behind a
 * busy reply), the history page, abort, withdraw, approvals, questions and
 * YOLO, and moving a bot between chats ("New chat", continuing a Past chat).
 * Acting on the chat a bot is on now goes through `bots.chat.ts`; moving
 * between chats through `chats.history.ts`; @mentions through
 * `bots.delivery.ts`; the bot row through `bots.service.ts`. Every action
 * takes the runtime it acts on (`rt`), the test seam.
 */
import { eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { authoredText, type OwnerAnswer } from "@tiny-agents/agent";
import { db, botChats, bots } from "../../db";
import { getAgentRuntime } from "./bots.runtime";
import {
  findBotRow,
  startBotConversation,
  submitToBot,
  reconcileBotConversation,
} from "./bots.conversation";
import { openBotChat } from "./bots.chat";
import type { ChatHistoryDTO } from "./bots.schema";
import { findPastChat, leaveChat } from "./chats.history";
import { deliverMentions } from "./bots.delivery";
import { publishBotChatEvent } from "./bots.events";
import { previewText } from "./bots.list";
import { requireApprovalAnswer, type Viewer } from "../people/access";
import { authorOf } from "../people/people.service";
import { getBot, updateBotRow, type BotAgentRuntime } from "./bots.service";
import type { YoloState } from "../../../shared/api/bots";

function runtime(): BotAgentRuntime {
  return getAgentRuntime();
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
  await updateBotRow(id, {
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
      updateBotRow(id, {
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
  const waitingCall = async () =>
    (await chat.read()).messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.taskId === input.taskId);
  await requireApprovalAnswer(viewer, input, waitingCall);
  // "Always allow" switches on the tool of the call being approved, never
  // whatever name the request carries (S5), and never a vault use. A call
  // that isn't there changes nothing; the decision below answers 409.
  const call = input.decision === "approved" && input.alwaysAllow ? await waitingCall() : undefined;
  if (call && call.name !== input.alwaysAllow) {
    throw Boom.badRequest(
      `"Always allow" must name the tool being approved (${call.name})`,
      undefined,
      "ALWAYS_ALLOW_MISMATCH",
    );
  }
  if (call?.vault) throw Boom.badRequest("Vault uses can't be always allowed");
  if (call) {
    const toolPermissions = { ...bot.toolPermissions, [call.name]: "allow" as const };
    await updateBotRow(id, { toolPermissions: JSON.stringify(toolPermissions) });
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
): Promise<YoloState> {
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
