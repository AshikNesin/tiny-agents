import { and, asc, eq, gte, ne, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { sanitizePeerText, type BotMessagingStore } from "@tiny-agents/agent";
import { botGuests, botMessages, bots, db } from "../../db";
import { createDeliveries, type DeliveryRuntime } from "./bots.delivery";
import { conversationOwner } from "./bots.owner";
import { app } from "../../app-root";

type DeliverReason = "unknown_bot" | "self" | "loop" | "budget" | "shared";

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

function reachableFrom(senderBotId: string) {
  const senderGuests = alias(botGuests, "sender_guests");
  const targetGuests = alias(botGuests, "target_guests");
  return notExists(
    db
      .select({ userId: senderGuests.userId })
      .from(senderGuests)
      .where(
        and(
          eq(senderGuests.botId, senderBotId),
          notExists(
            db
              .select({ userId: targetGuests.userId })
              .from(targetGuests)
              .where(
                and(eq(targetGuests.botId, bots.id), eq(targetGuests.userId, senderGuests.userId)),
              ),
          ),
        ),
      ),
  );
}

export type BotMessagingRuntime = DeliveryRuntime;

async function botNamed(name: string, exceptBotId: string): Promise<boolean> {
  const named = await db.query.bots.findFirst({
    where: eq(bots.name, name),
    columns: { id: true },
  });
  return named !== undefined && named.id !== exceptBotId;
}

export function createBotMessagingStore(rt: BotMessagingRuntime): BotMessagingStore {
  async function senderOf(conversationId: number) {
    const owner = await conversationOwner(conversationId);
    if (!owner) return null;
    return {
      id: owner.bot.id,
      name: owner.bot.name,
      unattended: owner.kind !== "chat",
      shared: owner.kind === "chat" && owner.bot.shared,
    };
  }

  const turnBudget = turnBudgetOf(rt);
  const deliveries = createDeliveries(rt);
  return {
    async deliver(input) {
      const sender = await senderOf(input.conversationId);
      if (!sender) return { delivered: false, reason: "unknown_bot" as DeliverReason };
      const named = and(
        eq(bots.name, input.toName),
        sender.shared ? reachableFrom(sender.id) : undefined,
      );
      const target = await db.query.bots.findFirst({
        where: named,
        columns: { id: true, name: true },
      });
      if (!target && sender.shared && (await botNamed(input.toName, sender.id))) {
        return { delivered: false, reason: "shared" };
      }
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
        .where(
          and(me ? ne(bots.id, me.id) : undefined, me?.shared ? reachableFrom(me.id) : undefined),
        )
        .orderBy(asc(bots.name));
    },
  };
}
