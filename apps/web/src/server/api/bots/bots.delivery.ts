/**
 * Deliveries (GLOSSARY: Delivery): a message put in front of a bot from
 * somewhere other than its own chat (an owner @mention, a bot-to-bot
 * message), recorded in the `bot_messages` ledger and answered with the
 * target's Finished reply, relayed into the conversation that asked.
 *
 * One module owns the whole lifecycle so its rules hold in one place:
 * - The ledger row is written before the submit, with the target
 *   conversation pinned on it; `deliveredAt` marks the submit done.
 * - The submit is idempotent by request id: a replay (pi-durable rerunning a
 *   tool task, a retried owner send) resubmits harmlessly or returns early.
 * - The answer is the Finished reply to the Delivery's request id, read from
 *   the pinned conversation, so it is found after the target starts a new
 *   chat and never confused with a mid-turn message or another Delivery's
 *   reply.
 * - Relay rows (kind="relay") never relay again: one answer per Delivery.
 */
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import {
  finishedReplyTo,
  sanitizePeerText,
  type AgentRuntime,
  type ChatMessage,
  type FinishedReply,
} from "@tiny-agents/agent";
import { db, botMessages, bots } from "../../db";
import {
  conversationRef,
  submitToBot,
  type Bot,
  type BotConversationRuntime,
} from "./bots.conversation";
import type { ChatRead } from "./bots.settled";

/** What the Delivery module needs from the runtime. */
export type DeliveryRuntime = BotConversationRuntime & Pick<AgentRuntime, "readChat" | "isBusy">;

interface DeliveryInput {
  /** Idempotency key of the submit and the ledger row. */
  requestId: string;
  kind: "send" | "mention";
  toBotId: string;
  /** Sending bot; null for an owner @mention. */
  fromBotId: string | null;
  /** Bot whose chat receives the answer; null = nobody (only the owner sees it). */
  replyToBotId: string | null;
  /** The text as written, kept on the ledger row. */
  text: string;
  /** What the target's model sees (already framed and sanitized). */
  prompt: string;
  peer: NonNullable<ChatMessage["peer"]>;
  /** Durable tool-call id (bot-to-bot sends): exactly-once row create across replays. */
  sourceKey?: string;
}

type DeliveryOutcome<Reason extends string = never> =
  | { status: "delivered"; queued: boolean }
  /** This request id was delivered before: nothing submitted, nothing charged. */
  | { status: "replayed" }
  | { status: "refused"; reason: Reason };

export interface Deliveries {
  /**
   * Record and submit one Delivery. `admit` runs only for a first-time
   * delivery (never for a replay) and may refuse it with a reason.
   */
  deliver<Reason extends string = never>(
    input: DeliveryInput,
    admit?: () => Promise<Reason | undefined>,
  ): Promise<DeliveryOutcome<Reason>>;
  /**
   * Answer the delivered, unanswered Deliveries submitted to this
   * conversation. `chat` is its state when the caller already read it.
   */
  answer(conversationId: number, chat?: ChatRead): Promise<number>;
  /** Answer every conversation with unanswered Deliveries (boot, tests). */
  sweep(): Promise<number>;
}

/** How a relayed reply is presented inside the receiving transcript. */
export function relayText(fromName: string, text: string): string {
  return `**Reply from ${fromName}:** ${text}`;
}

/** What a Finished reply relays as: its text, or a note when it has none. */
function answerText(reply: FinishedReply): string {
  if (reply.text) return sanitizePeerText(reply.text);
  // The provider's message stays out of another bot's transcript.
  return reply.error !== undefined ? "(couldn't answer: the model failed)" : "(no reply)";
}

/** The conversation a row's answer is read from (rows before pinning: the target's chat). */
const targetConversation = sql<string>`coalesce(${botMessages.conversationId}, ${bots.conversationId})`;

const unanswered = and(isNotNull(botMessages.deliveredAt), isNull(botMessages.answeredAt));

export function createDeliveries(rt: DeliveryRuntime): Deliveries {
  async function deliver<Reason extends string = never>(
    input: DeliveryInput,
    admit?: () => Promise<Reason | undefined>,
  ): Promise<DeliveryOutcome<Reason>> {
    const existing = await db.query.botMessages.findFirst({
      where: eq(botMessages.requestId, input.requestId),
      columns: { deliveredAt: true },
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

    if (!existing) {
      await db
        .insert(botMessages)
        .values({
          fromBotId: input.fromBotId,
          toBotId: input.toBotId,
          conversationId: target.conversationId,
          replyToBotId: input.replyToBotId,
          kind: input.kind,
          requestId: input.requestId,
          ...(input.sourceKey ? { sourceKey: input.sourceKey } : {}),
          text: input.text,
        })
        .onConflictDoNothing();
    }
    const queued = rt.isBusy(conversationRef(target.conversationId));
    await submitToBot(
      input.toBotId,
      { requestId: input.requestId, text: input.prompt, peer: input.peer },
      rt,
    );
    await db
      .update(botMessages)
      .set({ deliveredAt: new Date() })
      .where(eq(botMessages.requestId, input.requestId));
    // A target that already replied and went idle before the row was marked
    // delivered had its idle pass skip this row: answer it now. A target
    // still busy answers it on its own idle.
    const conversationId = conversationRef(target.conversationId);
    if (!rt.isBusy(conversationId)) {
      void answer(conversationId).catch((error: unknown) =>
        logger.warn({ error, conversationId }, "Answering a fast Delivery failed"),
      );
    }
    return { status: "delivered", queued };
  }

  async function markAnswered(id: string, replyCreatedAt: number) {
    const [updated] = await db
      .update(botMessages)
      .set({ answeredAt: new Date(), answerReplyAt: new Date(replyCreatedAt), kind: "relay" })
      .where(eq(botMessages.id, id))
      .returning({ id: botMessages.id });
    // A row gone meanwhile (its bot deleted) fails the relay.
    if (!updated) throw new Error(`Bot message ${id} not found`);
  }

  async function relay(
    row: { id: string; replyToBotId: string | null },
    fromName: string,
    reply: FinishedReply,
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
          text: relayText(fromName, answerText(reply)),
          peer: { kind: "reply", name: fromName },
        },
        rt,
      );
    }
    await markAnswered(row.id, reply.createdAt);
  }

  async function answer(
    conversationId: number,
    chat: ChatRead = () => rt.readChat(conversationId),
  ): Promise<number> {
    const rows = await db
      .select({
        id: botMessages.id,
        requestId: botMessages.requestId,
        replyToBotId: botMessages.replyToBotId,
        targetName: bots.name,
      })
      .from(botMessages)
      .innerJoin(bots, eq(bots.id, botMessages.toBotId))
      .where(and(unanswered, eq(targetConversation, String(conversationId))))
      .orderBy(asc(botMessages.createdAt));
    if (rows.length === 0) return 0;
    const state = await chat();
    let answered = 0;
    for (const row of rows) {
      try {
        const outcome = finishedReplyTo(state, row.requestId);
        // Not finished, or not in the transcript (yet: an input the runtime
        // has admitted but not placed; or ever: a row from before the target
        // conversation was pinned, whose chat has since been retired).
        if (outcome.status !== "answered") continue;
        await relay(row, row.targetName, outcome.reply);
        answered += 1;
      } catch (error) {
        logger.warn({ error, rowId: row.id }, "Delivery relay failed; will retry on next idle");
      }
    }
    return answered;
  }

  async function sweep(): Promise<number> {
    const pending = await db
      .selectDistinct({ conversationId: targetConversation })
      .from(botMessages)
      .innerJoin(bots, eq(bots.id, botMessages.toBotId))
      .where(unanswered);
    let answered = 0;
    for (const { conversationId } of pending)
      answered += await answer(conversationRef(conversationId));
    return answered;
  }

  return { deliver, answer, sweep };
}

/** The text a tagged bot receives: enough context to answer in-place. */
function mentionText(ownerContext: string, text: string): string {
  return `${ownerContext} ${text}`;
}

/**
 * Deliver a copy of an owner's message to every @mentioned bot (issue #12):
 * one Delivery (kind="mention") per target, answered back into the host
 * bot's chat. Failures never fail the owner's send: the host conversation
 * already got the message.
 */
export async function deliverMentions(
  host: Pick<Bot, "id" | "name">,
  input: { requestId: string; text: string; mentions?: string[] },
  rt: DeliveryRuntime,
): Promise<void> {
  const targets = await db
    .select({ id: bots.id })
    .from(bots)
    .where(and(inArray(bots.id, input.mentions ?? []), ne(bots.id, host.id)));
  if (targets.length === 0) return;
  const ownerContext = `[From the owner, in ${host.name}'s chat]`;
  const deliveries = createDeliveries(rt);
  for (const target of targets) {
    try {
      await deliveries.deliver({
        requestId: `mention-${input.requestId}-${target.id}`,
        kind: "mention",
        toBotId: target.id,
        fromBotId: null,
        replyToBotId: host.id,
        text: input.text,
        prompt: mentionText(ownerContext, sanitizePeerText(input.text)),
        peer: { kind: "mention", hostName: host.name },
      });
    } catch (error) {
      logger.warn({ error, hostId: host.id, targetId: target.id }, "Mention delivery failed");
    }
  }
}
