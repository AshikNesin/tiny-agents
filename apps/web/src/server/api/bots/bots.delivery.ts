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
 * - Answering is an Awaited submission (bots.awaited.ts): a Delivery whose
 *   turn a restart cut off is closed at boot, and the asking bot is told,
 *   unless it was sent more than a day ago (an old stuck row stays quiet).
 * - A bot-to-bot send runs in a fresh conversation of the target's own,
 *   unattended and on a routine run's token budget, so answering it never
 *   re-sends the target's whole chat history (and a routine that messages a
 *   bot cannot escape its own budget that way). An owner @mention still
 *   lands in the target's chat. The text must carry its own context, as
 *   `message_bot` tells the model.
 */
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import {
  sanitizePeerText,
  type AgentRuntime,
  type ChatMessage,
  type FinishedReply,
} from "@tiny-agents/agent";
import { db, botMessages, bots } from "../../db";
import {
  conversationRef,
  startBotConversation,
  submitToBot,
  type Bot,
  type BotConversationRuntime,
} from "./bots.conversation";
import { awaitedSubmissions } from "./bots.awaited";
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
  /** Boot: answer, or close as interrupted, every unanswered Delivery on an idle conversation. */
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
  if (reply.error !== undefined) return "(couldn't answer: the model failed)";
  if (reply.stoppedBy === "runCap")
    return "(couldn't finish: it made the most tool calls one reply may)";
  if (reply.stoppedBy === "budget") return "(couldn't finish: it used up its token budget)";
  return "(no reply)";
}

/** What an interrupted Delivery relays as. */
const INTERRUPTED_TEXT = "(couldn't answer: interrupted by a server restart)";

/** An interrupted Delivery older than this is closed without waking the asking bot. */
const INTERRUPTED_RELAY_WINDOW_MS = 24 * 60 * 60 * 1000;

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

    // A send gets a conversation of its own, kept on the row before the
    // submit, so a retried delivery reuses it.
    const own = input.kind === "send";
    const pinned = existing
      ? (existing.conversationId ?? target.conversationId)
      : own
        ? await startBotConversation(input.toBotId, rt, { unattended: "bot-message" })
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
      { requestId: input.requestId, text: input.prompt, peer: input.peer },
      rt,
      ownConversation ? { unattendedConversationId: pinned, unattended: "bot-message" } : undefined,
    );
    await db
      .update(botMessages)
      .set({ deliveredAt: new Date() })
      .where(eq(botMessages.requestId, input.requestId));
    // A target that already replied and went idle before the row was marked
    // delivered had its idle pass skip this row: answer it now. A target
    // still busy answers it on its own idle.
    if (!rt.isBusy(conversationId)) {
      void awaited
        .answer(conversationId)
        .catch((error: unknown) =>
          logger.warn({ error, conversationId }, "Answering a fast Delivery failed"),
        );
    }
    return { status: "delivered", queued };
  }

  /** Close the row; `replyCreatedAt` is the answering reply's, absent when interrupted. */
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
    // A row gone meanwhile (its bot deleted) fails the relay.
    if (!updated) throw new Error(`Bot message ${id} not found`);
  }

  /** Relay `text` into the asking bot's chat (when there is one), then close the row. */
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

  // Rows from before pinning, whose chat has since been retired, read as
  // interrupted at boot: their request is in no transcript the row names.
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
