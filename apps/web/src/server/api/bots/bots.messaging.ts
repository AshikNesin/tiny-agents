/**
 * BotMessagingStore adapter: the agent's `bots` toolkit delivers messages
 * between bots through the app.db ledger. The store owns the submit into the
 * target's durable conversation, so the exactly-once boundary (requestId) and
 * the delivery receipt (deliveredAt) commit together.
 */
import { prisma } from "@groot/core/database";
import type { AgentRuntime } from "@tiny-agents/agent";
import type { BotMessagingStore } from "@tiny-agents/agent";

/** Same shape as the ledger kinds (schema.sqlite.prisma BotMessage.kind). */
type DeliverReason = "unknown_bot" | "self" | "loop";

/** Loop guard: more than this many sends from one bot to one target in the window is a runaway loop. */
const LOOP_WINDOW_MS = 10 * 60 * 1000;
const LOOP_LIMIT = 8;

/** The message a bot sees when another bot writes to it. */
export function botToBotText(fromName: string, text: string): string {
  return `**Message from ${fromName} (bot):** ${text}`;
}

export function createBotMessagingStore(rt: AgentRuntime): BotMessagingStore {
  async function senderOf(conversationId: number) {
    return prisma.bot.findUnique({
      where: { conversationId: String(conversationId) },
      select: { id: true, name: true },
    });
  }

  return {
    async deliver(input) {
      const sender = await senderOf(input.conversationId);
      if (!sender) return { delivered: false, reason: "unknown_bot" as DeliverReason };
      const target = await prisma.bot.findFirst({
        where: { name: input.toName },
        select: { id: true, name: true, conversationId: true },
      });
      if (!target) return { delivered: false, reason: "unknown_bot" };
      if (target.id === sender.id) return { delivered: false, reason: "self" };

      const since = new Date(Date.now() - LOOP_WINDOW_MS);
      const recent = await prisma.botMessage.count({
        where: {
          fromBotId: sender.id,
          toBotId: target.id,
          kind: "send",
          createdAt: { gte: since },
        },
      });
      if (recent >= LOOP_LIMIT) return { delivered: false, reason: "loop" };

      // Exactly-once across pi-durable replays: a rerun of the tool task
      // recomputes the same requestId and sourceKey, so the row lands once
      // and the submit below is deduped by pi-durable itself.
      const existing = await prisma.botMessage.findUnique({
        where: { requestId: input.requestId },
      });
      if (existing) return { delivered: true };

      await rt.submit(Number(target.conversationId), {
        requestId: input.requestId,
        text: botToBotText(sender.name, input.text),
      });
      await prisma.botMessage.create({
        data: {
          fromBotId: sender.id,
          toBotId: target.id,
          replyToBotId: sender.id,
          kind: "send",
          requestId: input.requestId,
          sourceKey: input.sourceKey,
          text: input.text,
          deliveredAt: new Date(),
        },
      });
      return { delivered: true };
    },

    async roster(conversationId) {
      const me = await senderOf(conversationId);
      const bots = await prisma.bot.findMany({
        where: me ? { id: { not: me.id } } : undefined,
        select: { name: true, description: true },
        orderBy: { name: "asc" },
      });
      return bots;
    },
  };
}
