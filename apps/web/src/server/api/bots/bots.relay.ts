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
import { prisma } from "@groot/core/database";
import { logger } from "@groot/core/logger";
import { sanitizePeerText, type AgentRuntime, type ChatState } from "@tiny-agents/agent";
import { agentConfig, connectionToolCounts, toBot, withLinks } from "./bots.service";

/** How a relayed reply is presented inside the receiving transcript. */
export function relayText(fromName: string, text: string): string {
  return `**Reply from ${fromName}:** ${text}`;
}

/** Assistant replies of a transcript, oldest first, with their createdAt. */
async function assistantReplies(rt: AgentRuntime, conversationId: number) {
  const replies: { text: string; createdAt: number }[] = [];
  const sub = await rt.watchChat(conversationId, (events) => {
    for (const event of events) {
      if (event.type !== "snapshot") continue;
      for (const message of (event.state as ChatState).messages) {
        if (message.role !== "assistant") continue;
        if (message.text) replies.push({ text: message.text, createdAt: message.createdAt });
      }
    }
  });
  await sub.stop();
  return replies;
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
    const host = await prisma.bot.findUnique({
      where: { id: row.replyToBotId },
      include: withLinks,
    });
    if (!host) {
      await markAnswered(row.id, replyCreatedAt);
      return true;
    }
    // Same reconciliation as sends and mentions: the host's durable config
    // must not be staler than its row before it answers.
    await rt.configure(
      Number(host.conversationId),
      agentConfig({ ...toBot(host), connectionToolCounts: connectionToolCounts(host) }),
    );
    await rt.submit(Number(host.conversationId), {
      requestId: `botmsg-reply-${row.id}`,
      text: relayText(fromName, sanitizePeerText(replyText)),
    });
    await markAnswered(row.id, replyCreatedAt);
    return true;
  }

  async function markAnswered(id: string, replyCreatedAt: number) {
    await prisma.botMessage.update({
      where: { id },
      data: { answeredAt: new Date(), answerReplyAt: new Date(replyCreatedAt), kind: "relay" },
    });
  }

  async function relayForBot(botId: string): Promise<number> {
    const rows = await prisma.botMessage.findMany({
      where: { toBotId: botId, deliveredAt: { not: null }, answeredAt: null },
      orderBy: { createdAt: "asc" },
    });
    if (rows.length === 0) return 0;
    const target = await prisma.bot.findUnique({
      where: { id: botId },
      select: { conversationId: true, name: true },
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

  async function sweep(): Promise<number> {
    const pending = await prisma.botMessage.findMany({
      where: { deliveredAt: { not: null }, answeredAt: null },
      select: { toBotId: true },
      distinct: ["toBotId"],
    });
    let relayed = 0;
    for (const { toBotId } of pending) relayed += await relayForBot(toBotId);
    return relayed;
  }

  return { relayForBot, sweep };
}
