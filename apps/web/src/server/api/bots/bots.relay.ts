/**
 * The relay: answers of tagged/messaged bots flow back into the conversation
 * that asked. Runs on the runtime's activity feed (a conversation just went
 * idle = its reply finished), reads the target's last assistant message and
 * submits it into the reply-to conversation as a new user turn.
 *
 * Relay rows are marked kind="relay" so they never relay again: one answer
 * per delivery, continued conversation is the model's explicit choice via
 * message_bot (the loop guard caps that too).
 */
import { prisma } from "@groot/core/database";
import { logger } from "@groot/core/logger";
import type { AgentRuntime } from "@tiny-agents/agent";

/** How a relayed reply is presented inside the receiving transcript. */
export function relayText(fromName: string, text: string): string {
  return `**Reply from ${fromName}:** ${text}`;
}

export interface BotRelay {
  /** Relay finished replies for every unanswered delivery of this target bot. */
  relayForBot(botId: string): Promise<number>;
  /** Sweep every bot with unanswered deliveries (boot, tests). */
  sweep(): Promise<number>;
  /** Wire the relay onto the runtime's activity feed. */
  attach(runtime: AgentRuntime): () => void;
}

export function createBotRelay(rt: AgentRuntime): BotRelay {
  async function relayRow(
    row: {
      id: string;
      replyToBotId: string | null;
    },
    fromName: string,
    replyText: string,
  ): Promise<boolean> {
    if (!row.replyToBotId) {
      // Nothing to relay into (owner-only delivery); mark answered so it
      // never shows up in the sweep again.
      await markAnswered(row.id);
      return true;
    }
    const host = await prisma.bot.findUnique({
      where: { id: row.replyToBotId },
      select: { conversationId: true },
    });
    if (!host) {
      await markAnswered(row.id);
      return true;
    }
    await rt.submit(Number(host.conversationId), {
      requestId: `botmsg-reply-${row.id}`,
      text: relayText(fromName, replyText),
    });
    await markAnswered(row.id);
    return true;
  }

  async function markAnswered(id: string) {
    await prisma.botMessage.update({
      where: { id },
      data: { answeredAt: new Date(), kind: "relay" },
    });
  }

  async function relayForBot(botId: string): Promise<number> {
    const rows = await prisma.botMessage.findMany({
      where: { toBotId: botId, deliveredAt: { not: null }, answeredAt: null },
      orderBy: { createdAt: "asc" },
      include: { to: { select: { name: true } } },
    });
    if (rows.length === 0) return 0;
    const target = await prisma.bot.findUnique({
      where: { id: botId },
      select: { conversationId: true, name: true },
    });
    if (!target) return 0;
    const last = await rt.lastMessage(Number(target.conversationId));
    if (!last || last.role !== "assistant") return 0;
    let relayed = 0;
    for (const row of rows) {
      try {
        if (await relayRow(row, target.name, last.text)) relayed += 1;
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

  function attach(runtime: AgentRuntime): () => void {
    return runtime.onActivity(async (change) => {
      if (change.busy) return;
      try {
        const bot = await prisma.bot.findUnique({
          where: { conversationId: String(change.conversation) },
          select: { id: true },
        });
        if (bot) await relayForBot(bot.id);
      } catch {
        // A deleted bot's conversation is gone from app.db; nothing to relay.
      }
    });
  }

  return { relayForBot, sweep, attach };
}
