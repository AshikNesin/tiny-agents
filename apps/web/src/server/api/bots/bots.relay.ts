/**
 * The relay: answers of tagged/messaged bots flow back into the conversation
 * that asked. Runs on the runtime's activity feed (a conversation just went
 * idle = its reply finished), reads the target's transcript and submits the
 * matching reply into the reply-to conversation as a new user turn.
 *
 * Relay rows are marked kind="relay" so they never relay again: one answer
 * per delivery, continued conversation is the model's explicit choice via
 * message_bot (the loop guard caps that too).
 */
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { sanitizePeerText, type AgentRuntime } from "@tiny-agents/agent";
import { db, botMessages, bots } from "../../db";
import { submitToBot } from "./bots.conversation";

/** How a relayed reply is presented inside the receiving transcript. */
export function relayText(fromName: string, text: string): string {
  return `**Reply from ${fromName}:** ${text}`;
}

/**
 * Replies a delivery can be answered with: finished assistant replies that
 * carry text, oldest first. None while the target is still busy (see
 * `finishedReplies`); its own idle triggers the sweep that relays it whole.
 */
async function assistantReplies(rt: Pick<AgentRuntime, "finishedReplies">, conversationId: number) {
  const replies = await rt.finishedReplies(conversationId);
  return replies.filter((reply) => reply.text);
}

/**
 * Correlates deliveries with replies. A row is answered only by an assistant
 * reply created after the row was delivered AND after the reply that answered
 * the previous row of the same target: a stale reply (one that predates the
 * delivery, e.g. a boot sweep) never answers, and one reply never answers two
 * rows (queued deliveries each get their own answer, in order).
 */
export function matchReplies<
  T extends { id: string; replyToBotId: string | null; deliveredAt: Date },
>(
  rows: T[],
  replies: { text: string; createdAt: number }[],
): (T & { reply: { text: string; createdAt: number } })[] {
  const matched: (T & { reply: { text: string; createdAt: number } })[] = [];
  let floor = 0;
  for (const row of rows) {
    const floorAt = Math.max(floor, row.deliveredAt.getTime());
    const reply = replies.find((r) => r.createdAt > floorAt);
    if (!reply) continue;
    floor = reply.createdAt;
    matched.push({ ...row, reply });
  }
  return matched;
}

export interface BotRelay {
  /** Relay finished replies for every unanswered delivery of this target bot. */
  relayForBot(botId: string): Promise<number>;
  /** The same for the bot behind a conversation that just went idle (the activity feed). */
  relayForConversation(conversationId: number): Promise<number>;
  /** Sweep every bot with unanswered deliveries (boot, tests). */
  sweep(): Promise<number>;
}

export function createBotRelay(rt: AgentRuntime): BotRelay {
  async function relayRow(
    row: {
      id: string;
      replyToBotId: string | null;
    },
    fromName: string,
    replyText: string,
    replyCreatedAt: number,
  ): Promise<boolean> {
    if (!row.replyToBotId) {
      // Nothing to relay into (owner-only delivery); mark answered so it
      // never shows up in the sweep again.
      await markAnswered(row.id, replyCreatedAt);
      return true;
    }
    const host = await db.query.bots.findFirst({
      where: eq(bots.id, row.replyToBotId),
      columns: { id: true },
    });
    if (!host) {
      await markAnswered(row.id, replyCreatedAt);
      return true;
    }
    await submitToBot(
      host.id,
      {
        requestId: `botmsg-reply-${row.id}`,
        text: relayText(fromName, sanitizePeerText(replyText)),
        peer: { kind: "reply", name: fromName },
      },
      rt,
    );
    await markAnswered(row.id, replyCreatedAt);
    return true;
  }

  async function markAnswered(id: string, replyCreatedAt: number) {
    const [updated] = await db
      .update(botMessages)
      .set({ answeredAt: new Date(), answerReplyAt: new Date(replyCreatedAt), kind: "relay" })
      .where(eq(botMessages.id, id))
      .returning({ id: botMessages.id });
    // A row gone meanwhile (its bot deleted) fails the relay, as Prisma's update did.
    if (!updated) throw new Error(`Bot message ${id} not found`);
  }

  async function relayForBot(botId: string): Promise<number> {
    const rows = await db
      .select()
      .from(botMessages)
      .where(
        and(
          eq(botMessages.toBotId, botId),
          isNotNull(botMessages.deliveredAt),
          isNull(botMessages.answeredAt),
        ),
      )
      .orderBy(asc(botMessages.createdAt));
    if (rows.length === 0) return 0;
    const target = await db.query.bots.findFirst({
      where: eq(bots.id, botId),
      columns: { conversationId: true, name: true },
    });
    if (!target) return 0;
    const replies = await assistantReplies(rt, Number(target.conversationId));
    // deliveredAt is non-null by the query above; assert once for matchReplies.
    const pendingRows = rows.map((row) => ({ ...row, deliveredAt: row.deliveredAt! }));
    const matched = matchReplies(pendingRows, replies);
    let relayed = 0;
    for (const row of matched) {
      try {
        await relayRow(row, target.name, row.reply.text, row.reply.createdAt);
        relayed += 1;
      } catch (error) {
        logger.warn({ error, rowId: row.id }, "Bot message relay failed; will retry on next idle");
      }
    }
    return relayed;
  }

  async function relayForConversation(conversationId: number): Promise<number> {
    const [pending] = await db
      .select({ toBotId: botMessages.toBotId })
      .from(botMessages)
      .innerJoin(bots, eq(bots.id, botMessages.toBotId))
      .where(
        and(
          isNotNull(botMessages.deliveredAt),
          isNull(botMessages.answeredAt),
          eq(bots.conversationId, String(conversationId)),
        ),
      )
      .limit(1);
    return pending ? relayForBot(pending.toBotId) : 0;
  }

  async function sweep(): Promise<number> {
    const pending = await db
      .selectDistinct({ toBotId: botMessages.toBotId })
      .from(botMessages)
      .where(and(isNotNull(botMessages.deliveredAt), isNull(botMessages.answeredAt)));
    let relayed = 0;
    for (const { toBotId } of pending) relayed += await relayForBot(toBotId);
    return relayed;
  }

  return { relayForBot, relayForConversation, sweep };
}
