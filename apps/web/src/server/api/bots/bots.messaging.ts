/**
 * BotMessagingStore adapter: the agent's `bots` toolkit delivers messages
 * between bots through the app.db ledger. The store owns the submit into the
 * target's durable conversation, so the exactly-once boundary (requestId) and
 * the delivery receipt (deliveredAt) commit together.
 */
import { prisma } from "@groot/core/database";
import type { AgentRuntime } from "@tiny-agents/agent";
import { sanitizePeerText, type BotMessagingStore } from "@tiny-agents/agent";

/** Same shape as the ledger kinds (schema.sqlite.prisma BotMessage.kind). */
type DeliverReason = "unknown_bot" | "self" | "loop" | "budget";

/** Loop guard: more than this many sends from one bot to one target in the window is a runaway loop. */
const LOOP_WINDOW_MS = 10 * 60 * 1000;
const LOOP_LIMIT = 8;
/** Per-turn budget (issue #16): a single reply may not message more than this many bots. */
const TURN_LIMIT = 3;

/**
 * Sends per conversation in the current reply. Charged only on first-time
 * deliveries (a replayed requestId returns early), and reset when the
 * conversation next goes idle (the store listens on the activity feed).
 */
function createTurnBudget(rt: Pick<AgentRuntime, "onActivity">) {
  const sendsThisTurn = new Map<number, number>();
  rt.onActivity((change) => {
    if (!change.busy) sendsThisTurn.delete(Number(change.conversation));
  });
  return {
    count(conversationId: number) {
      return sendsThisTurn.get(conversationId) ?? 0;
    },
    charge(conversationId: number) {
      sendsThisTurn.set(conversationId, this.count(conversationId) + 1);
    },
  };
}

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

  const turnBudget = createTurnBudget(rt);
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
      // Per-turn budget (issue #16): the idempotency check below must run
      // first so a replayed tool task returns early without being charged.
      const existing = await prisma.botMessage.findUnique({
        where: { requestId: input.requestId },
      });
      if (existing) return { delivered: true };
      const sent = turnBudget.count(input.conversationId);
      if (sent >= TURN_LIMIT) return { delivered: false, reason: "budget" as DeliverReason };

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
      // and the submit below is deduped by pi-durable itself (the early
      // return above is the replay path).
      const queued = rt.isBusy(Number(target.conversationId));
      await rt.submit(Number(target.conversationId), {
        requestId: input.requestId,
        text: botToBotText(sender.name, sanitizePeerText(input.text)),
        peer: { kind: "message", name: sender.name },
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
      turnBudget.charge(input.conversationId);
      return { delivered: true, ...(queued ? { queued: true } : {}) };
    },

    async roster(conversationId) {
      const me = await senderOf(conversationId);
      const bots = await prisma.bot.findMany({
        where: me ? { id: { not: me.id } } : undefined,
        select: { name: true, description: true, conversationId: true },
        orderBy: { name: "asc" },
      });
      return bots.map(({ conversationId: botConversation, ...bot }) => ({
        ...bot,
        busy: rt.isBusy(Number(botConversation)),
      }));
    },
  };
}
