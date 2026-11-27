import { ownerToolPermissions, setOwnerToolPermissions } from "./tool-permissions";
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
import { conversationRef } from "./bots.conversation";
import type { ChatHistoryDTO } from "./bots.schema";
import { findPastChat, leaveChat } from "./chats.history";
import { deliverMentions, type MentionSender } from "./bots.delivery";
import { publishBotChatEvent } from "./bots.events";
import { previewText } from "./bots.list";
import { requireApprovalAnswer, type Viewer } from "../people/access";
import { authorOf } from "../people/people.service";
import { getBot, updateBotRow, type BotAgentRuntime } from "./bots.service";
import type { YoloState } from "../../../shared/api/bots";
import { withToolPicks } from "../../../shared/tool-picks";
import type { ToolChoice } from "@tiny-agents/code/contracts";
import { getConnectionManager } from "../connections/connections.manager";
import { reachedConnections } from "./bot-reach";
import { botPermissions } from "./tool-permissions";
import { checkToolPicks, toolChoices, usableTools } from "./tool-choices";

function runtime(): BotAgentRuntime {
  return getAgentRuntime();
}

export async function botToolChoices(id: string): Promise<ToolChoice[]> {
  const bot = await getBot(id);
  const [rows, owner] = await Promise.all([reachedConnections(bot), ownerToolPermissions()]);
  return toolChoices(
    usableTools(rows, botPermissions(owner, bot.toolPermissions), getConnectionManager()),
  );
}

async function withPickedTools(id: string, text: string, picks: string[] | undefined) {
  if (!picks || picks.length === 0) return text;
  return withToolPicks(text, checkToolPicks(await botToolChoices(id), picks));
}

export async function sendMessage(
  id: string,
  input: {
    requestId: string;
    text: string;
    mentions?: string[];
    attachments?: string[];
    tools?: string[];
    whenBusy?: "steer" | "followUp";
  },
  rt: BotAgentRuntime = runtime(),
  viewer: Viewer,
) {
  const chat = await openBotChat(id, rt);
  const shared = chat.row.guests?.length;
  const author = shared ? await authorOf(viewer.userId) : undefined;
  const typed = author ? authoredText(author.name, input.text) : input.text;
  const picked = await withPickedTools(id, input.text, input.tools);
  const text = author ? authoredText(author.name, picked) : picked;
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
    lastMessagePreview: previewText(typed, attachments),
  });
  if (input.mentions && input.mentions.length > 0) {
    const guest = viewer.kind === "guest";
    const sender: MentionSender = guest
      ? { viewer, name: author?.name ?? `User ${viewer.userId}`, ...(author ? { author } : {}) }
      : { viewer, name: "the owner" };
    await deliverMentions(bot, input, rt, sender);
  }
  await chat.dismissPendingQuestions().catch((error: unknown) => {
    logger.warn({ error, botId: id }, "Failed to dismiss questions after an owner message");
  });
}

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

export async function withdrawMessage(
  id: string,
  input: { requestId: string },
  viewer: Viewer,
  rt: BotAgentRuntime = runtime(),
) {
  const chat = await openBotChat(id, rt);
  if (viewer.kind === "guest") {
    const { queued } = await chat.read();
    const mine = queued.some(
      (item) => item.requestId === input.requestId && item.author?.id === viewer.userId,
    );
    if (!mine) throw Boom.forbidden("Only the author can withdraw a message");
  }
  return chat.withdraw(input.requestId);
}

export async function resetConversation(id: string, rt: BotAgentRuntime = runtime()) {
  const old = await findBotRow(id);
  const conversationId = await startBotConversation(id, rt);
  await leaveChat(
    old,
    () =>
      updateBotRow(id, {
        conversationId,
        chatStartedAt: new Date(),
        lastReadAt: new Date(),
        lastMessagePreview: null,
        lastActivityAt: new Date(),
      }),
    rt,
  );
  return getBot(id);
}

export async function rewindChat(id: string, at: string, rt: BotAgentRuntime = runtime()) {
  const old = await findBotRow(id);
  const ref = conversationRef(old.conversationId);
  if (rt.isBusy(ref))
    throw Boom.conflict("Stop the reply before going back to an earlier message.");
  const { messages } = await rt.readChat(ref);
  const index = messages.findIndex((message) => message.id === at && message.role === "user");
  if (index < 0) throw Boom.notFound("That message is not in this chat.");
  const before = messages.slice(0, index).findLast((message) => /^e\d+$/.test(message.id));
  const conversationId = before
    ? String(await rt.fork(ref, before.id))
    : await startBotConversation(id, rt);
  await leaveChat(
    old,
    () =>
      updateBotRow(id, {
        conversationId,
        lastReadAt: new Date(),
        lastActivityAt: new Date(),
        lastMessagePreview: before ? previewText(before.text) || null : null,
      }),
    rt,
  );
  await reconcileBotConversation(id, rt);
  return getBot(id);
}

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

export async function decideApproval(
  id: string,
  input: {
    taskId: number;
    decision: "approved" | "denied";
    alwaysAllow?: string;
    everyBot?: boolean;
    grant?: boolean;
  },
  rt: BotAgentRuntime = runtime(),
  viewer: Viewer,
) {
  const chat = await openBotChat(id, rt);
  const { bot } = chat;
  const waitingCall = async () =>
    (await chat.read()).messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.taskId === input.taskId);
  await requireApprovalAnswer(viewer, input, waitingCall);
  const call = input.decision === "approved" && input.alwaysAllow ? await waitingCall() : undefined;
  if (call && call.name !== input.alwaysAllow) {
    throw Boom.badRequest(
      `"Always allow" must name the tool being approved (${call.name})`,
      undefined,
      "ALWAYS_ALLOW_MISMATCH",
    );
  }
  if (call?.vault) throw Boom.badRequest("Vault uses can't be always allowed");
  if (call && input.everyBot) {
    await setOwnerToolPermissions({ ...(await ownerToolPermissions()), [call.name]: "allow" });
    const { [call.name]: _own, ...toolPermissions } = bot.toolPermissions;
    await updateBotRow(id, { toolPermissions: JSON.stringify(toolPermissions) });
    await reconcileBotConversation(id, rt);
  } else if (call) {
    const toolPermissions = { ...bot.toolPermissions, [call.name]: "allow" as const };
    await updateBotRow(id, { toolPermissions: JSON.stringify(toolPermissions) });
    await reconcileBotConversation(id, rt);
  }
  await chat.decideApproval(input.taskId, input.decision, { grant: input.grant });
}

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

export async function answerQuestions(
  id: string,
  input: { taskId: number; answers: OwnerAnswer[] | null },
  rt: BotAgentRuntime = runtime(),
  viewer: Viewer,
) {
  const chat = await openBotChat(id, rt);
  const answeredBy =
    viewer.kind === "guest" && chat.row.guests?.length
      ? `${(await authorOf(viewer.userId)).name} (guest)`
      : undefined;
  await chat.answerQuestions(input.taskId, input.answers, answeredBy);
}
