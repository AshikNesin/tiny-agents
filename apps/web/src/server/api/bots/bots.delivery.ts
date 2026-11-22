import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import {
  sanitizePeerText,
  type AgentRuntime,
  type ChatMessage,
  type FinishedReply,
} from "@tiny-agents/agent";
import { db, botMessages, bots } from "../../db";
import { openableBots, type Viewer } from "../people/access";
import {
  conversationRef,
  startBotConversation,
  submitToBot,
  type Bot,
  type BotConversationRuntime,
} from "./bots.conversation";
import { awaitedSubmissions } from "./bots.awaited";
import type { ChatRead } from "./bots.settled";

export type DeliveryRuntime = BotConversationRuntime & Pick<AgentRuntime, "readChat" | "isBusy">;

interface DeliveryInput {
  requestId: string;
  kind: "send" | "mention";
  toBotId: string;
  fromBotId: string | null;
  replyToBotId: string | null;
  text: string;
  prompt: string;
  peer: NonNullable<ChatMessage["peer"]>;
  author?: ChatMessage["author"];
  sourceKey?: string;
  conversationId?: string;
}

type DeliveryOutcome<Reason extends string = never> =
  | { status: "delivered"; queued: boolean }
  | { status: "replayed" }
  | { status: "refused"; reason: Reason };

export interface Deliveries {
  deliver<Reason extends string = never>(
    input: DeliveryInput,
    admit?: () => Promise<Reason | undefined>,
  ): Promise<DeliveryOutcome<Reason>>;
  answer(conversationId: number, chat?: ChatRead): Promise<number>;
  sweep(): Promise<number>;
}

export function relayText(fromName: string, text: string): string {
  return `**Reply from ${fromName}:** ${text}`;
}

function answerText(reply: FinishedReply): string {
  if (reply.text) return sanitizePeerText(reply.text);
  if (reply.error !== undefined) return "(couldn't answer: the model failed)";
  if (reply.stoppedBy === "runCap")
    return "(couldn't finish: it made the most tool calls one reply may)";
  if (reply.stoppedBy === "budget") return "(couldn't finish: it used up its token budget)";
  return "(no reply)";
}

const INTERRUPTED_TEXT = "(couldn't answer: interrupted by a server restart)";

const INTERRUPTED_RELAY_WINDOW_MS = 24 * 60 * 60 * 1000;

const targetConversation = sql<string>`coalesce(${botMessages.conversationId}, ${bots.conversationId})`;

const unanswered = and(isNotNull(botMessages.deliveredAt), isNull(botMessages.answeredAt));

export function createDeliveries(rt: DeliveryRuntime): Deliveries {
  async function deliver<Reason extends string = never>(
    input: DeliveryInput,
    admit?: () => Promise<Reason | undefined>,
  ): Promise<DeliveryOutcome<Reason>> {
    const existing = await db.query.botMessages.findFirst({
      where: eq(botMessages.requestId, input.requestId),
      columns: { deliveredAt: true, conversationId: true, ownConversation: true },
    });
    if (existing?.deliveredAt) return { status: "replayed" };
    if (!existing && admit) {
      const reason = await admit();
      if (reason !== undefined) return { status: "refused", reason };
    }
    const target = await db.query.bots.findFirst({
      where: eq(bots.id, input.toBotId),
      columns: { conversationId: true },
    });
    if (!target) throw new Error(`Bot ${input.toBotId} not found`);

    const own = input.kind === "send";
    const pinned = existing
      ? (existing.conversationId ?? target.conversationId)
      : own
        ? (input.conversationId ??
          (await startBotConversation(input.toBotId, rt, { unattended: "bot-message" })))
        : target.conversationId;
    if (!existing) {
      await db
        .insert(botMessages)
        .values({
          fromBotId: input.fromBotId,
          toBotId: input.toBotId,
          conversationId: pinned,
          ownConversation: own,
          replyToBotId: input.replyToBotId,
          kind: input.kind,
          requestId: input.requestId,
          ...(input.sourceKey ? { sourceKey: input.sourceKey } : {}),
          text: input.text,
        })
        .onConflictDoNothing();
    }
    const conversationId = conversationRef(pinned);
    const ownConversation = existing ? existing.ownConversation : own;
    const queued = rt.isBusy(conversationId);
    await submitToBot(
      input.toBotId,
      {
        requestId: input.requestId,
        text: input.prompt,
        peer: input.peer,
        ...(input.author ? { author: input.author } : {}),
      },
      rt,
      ownConversation ? { unattendedConversationId: pinned, unattended: "bot-message" } : undefined,
    );
    await db
      .update(botMessages)
      .set({ deliveredAt: new Date() })
      .where(eq(botMessages.requestId, input.requestId));
    if (!rt.isBusy(conversationId)) {
      void awaited
        .answer(conversationId)
        .catch((error: unknown) =>
          logger.warn({ error, conversationId }, "Answering a fast Delivery failed"),
        );
    }
    return { status: "delivered", queued };
  }

  async function markAnswered(id: string, replyCreatedAt?: number) {
    const [updated] = await db
      .update(botMessages)
      .set({
        answeredAt: new Date(),
        answerReplyAt: replyCreatedAt !== undefined ? new Date(replyCreatedAt) : null,
        kind: "relay",
      })
      .where(eq(botMessages.id, id))
      .returning({ id: botMessages.id });
    if (!updated) throw new Error(`Bot message ${id} not found`);
  }

  async function relay(
    row: { id: string; replyToBotId: string | null },
    fromName: string,
    text: string,
    replyCreatedAt?: number,
  ): Promise<void> {
    const host = row.replyToBotId
      ? await db.query.bots.findFirst({
          where: eq(bots.id, row.replyToBotId),
          columns: { id: true },
        })
      : undefined;
    if (host) {
      await submitToBot(
        host.id,
        {
          requestId: `botmsg-reply-${row.id}`,
          text: relayText(fromName, text),
          peer: { kind: "reply", name: fromName },
        },
        rt,
      );
    }
    await markAnswered(row.id, replyCreatedAt);
  }

  const awaited = awaitedSubmissions(rt, {
    name: "delivery",
    async pending(conversationId?: number) {
      const rows = await db
        .select({
          id: botMessages.id,
          requestId: botMessages.requestId,
          replyToBotId: botMessages.replyToBotId,
          deliveredAt: botMessages.deliveredAt,
          targetName: bots.name,
          conversationId: targetConversation,
        })
        .from(botMessages)
        .innerJoin(bots, eq(bots.id, botMessages.toBotId))
        .where(
          and(
            unanswered,
            conversationId === undefined
              ? undefined
              : eq(targetConversation, String(conversationId)),
          ),
        )
        .orderBy(asc(botMessages.createdAt));
      return rows.map((row) => ({ ...row, conversationId: conversationRef(row.conversationId) }));
    },
    answered: (row, reply) => relay(row, row.targetName, answerText(reply), reply.createdAt),
    async interrupted(row) {
      const sentAt = row.deliveredAt?.getTime() ?? 0;
      if (Date.now() - sentAt > INTERRUPTED_RELAY_WINDOW_MS) await markAnswered(row.id);
      else await relay(row, row.targetName, INTERRUPTED_TEXT);
    },
  });

  return { deliver, answer: awaited.answer, sweep: awaited.sweep };
}

function mentionText(sender: string, hostName: string, text: string): string {
  return `[From ${sender}, in ${hostName}'s chat] ${text}`;
}

export interface MentionSender {
  viewer: Viewer;
  name: string;
  author?: ChatMessage["author"];
}

export async function deliverMentions(
  host: Pick<Bot, "id" | "name">,
  input: { requestId: string; text: string; mentions?: string[] },
  rt: DeliveryRuntime,
  sender: MentionSender,
): Promise<void> {
  const mentioned = (input.mentions ?? []).filter((id) => id !== host.id);
  const targets = mentioned.length
    ? await db
        .select({ id: bots.id })
        .from(bots)
        .where(inArray(bots.id, [...new Set(mentioned)]))
    : [];
  if (targets.length === 0) return;
  const openable = await openableBots(
    sender.viewer,
    targets.map((target) => target.id),
  );
  const reachable = targets.filter((target) => openable.has(target.id));
  if (reachable.length === 0) return;
  const text = sanitizePeerText(input.text);
  const prompt = mentionText(sender.name, host.name, text);
  const peer: NonNullable<ChatMessage["peer"]> = { kind: "mention", hostName: host.name };
  const deliveries = createDeliveries(rt);
  for (const target of reachable) {
    try {
      await deliveries.deliver({
        requestId: `mention-${input.requestId}-${target.id}`,
        kind: "mention",
        toBotId: target.id,
        fromBotId: null,
        replyToBotId: host.id,
        text: input.text,
        prompt,
        peer,
        ...(sender.author ? { author: sender.author } : {}),
      });
    } catch (error) {
      logger.warn({ error, hostId: host.id, targetId: target.id }, "Mention delivery failed");
    }
  }
}
