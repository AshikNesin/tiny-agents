import { and, asc, eq, gte, ne } from "drizzle-orm";
import { sanitizePeerText, type BotMessagingStore } from "@tiny-agents/agent";
import { db, botMessages, bots } from "../../db";
import { createDeliveries, type DeliveryRuntime } from "./bots.delivery";
import { conversationOwner } from "./bots.owner";
import { app } from "../../app-root";

type DeliverReason = "unknown_bot" | "self" | "loop" | "budget";

const LOOP_WINDOW_MS = 10 * 60 * 1000;
const LOOP_LIMIT = 8;
const TURN_LIMIT = 3;

export interface TurnBudget {
  count(conversationId: number): number;
  charge(conversationId: number): void;
  reset(conversationId: number): void;
}

export function turnBudgetOf(rt: object): TurnBudget {
  const turnBudgets = app().turnBudgets;
  let budget = turnBudgets.get(rt);
  if (!budget) {
    const sendsThisTurn = new Map<number, number>();
    budget = {
      count: (conversationId) => sendsThisTurn.get(conversationId) ?? 0,
      charge: (conversationId) =>
        void sendsThisTurn.set(conversationId, (sendsThisTurn.get(conversationId) ?? 0) + 1),
      reset: (conversationId) => void sendsThisTurn.delete(conversationId),
    };
    turnBudgets.set(rt, budget);
  }
  return budget;
}

function botToBotText(fromName: string, text: string): string {
  return `**Message from ${fromName} (bot):** ${text}`;
}

export type BotMessagingRuntime = DeliveryRuntime;

export function createBotMessagingStore(rt: BotMessagingRuntime): BotMessagingStore {
  async function senderOf(conversationId: number) {
    const owner = await conversationOwner(conversationId);
    if (!owner) return null;
    return { id: owner.bot.id, name: owner.bot.name, unattended: owner.kind !== "chat" };
  }

  const turnBudget = turnBudgetOf(rt);
  const deliveries = createDeliveries(rt);
  return {
    async deliver(input) {
      const sender = await senderOf(input.conversationId);
      if (!sender) return { delivered: false, reason: "unknown_bot" as DeliverReason };
      const target = await db.query.bots.findFirst({
        where: eq(bots.name, input.toName),
        columns: { id: true, name: true },
      });
      if (!target) return { delivered: false, reason: "unknown_bot" };
      if (target.id === sender.id) return { delivered: false, reason: "self" };

      const outcome = await deliveries.deliver<DeliverReason>(
        {
          requestId: input.requestId,
          kind: "send",
          toBotId: target.id,
          fromBotId: sender.id,
          replyToBotId: sender.unattended ? null : sender.id,
          text: input.text,
          prompt: botToBotText(sender.name, sanitizePeerText(input.text)),
          peer: { kind: "message", name: sender.name },
          sourceKey: input.sourceKey,
        },
        async () => {
          if (turnBudget.count(input.conversationId) >= TURN_LIMIT) return "budget";
          const since = new Date(Date.now() - LOOP_WINDOW_MS);
          const recent = await db.$count(
            botMessages,
            and(
              eq(botMessages.fromBotId, sender.id),
              eq(botMessages.toBotId, target.id),
              eq(botMessages.kind, "send"),
              gte(botMessages.createdAt, since),
            ),
          );
          return recent >= LOOP_LIMIT ? "loop" : undefined;
        },
      );
      if (outcome.status === "refused") return { delivered: false, reason: outcome.reason };
      if (outcome.status === "replayed") return { delivered: true };
      turnBudget.charge(input.conversationId);
      return { delivered: true, ...(outcome.queued ? { queued: true } : {}) };
    },

    async roster(conversationId) {
      const me = await senderOf(conversationId);
      return db
        .select({ name: bots.name, description: bots.description })
        .from(bots)
        .where(me ? ne(bots.id, me.id) : undefined)
        .orderBy(asc(bots.name));
    },
  };
}
