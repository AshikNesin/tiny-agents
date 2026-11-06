/**
 * BotMessagingStore adapter: the agent's `bots` toolkit sends messages
 * between bots as Deliveries (bots.delivery.ts). This adapter adds the
 * sender's guards: the per-turn budget and the loop guard.
 */
import { and, asc, eq, gte, ne } from "drizzle-orm";
import { sanitizePeerText, type BotMessagingStore } from "@tiny-agents/agent";
import { db, botMessages, bots } from "../../db";
import { conversationRef } from "./bots.conversation";
import { createDeliveries, type DeliveryRuntime } from "./bots.delivery";
import { conversationOwner } from "./bots.owner";

/** Why a delivery was refused (the bots toolkit's reasons). */
type DeliverReason = "unknown_bot" | "self" | "loop" | "budget";

/** Loop guard: more than this many sends from one bot to one target in the window is a runaway loop. */
const LOOP_WINDOW_MS = 10 * 60 * 1000;
const LOOP_LIMIT = 8;
/** Per-turn budget (issue #16): a single reply may not message more than this many bots. */
const TURN_LIMIT = 3;

/**
 * Sends per conversation in the current reply. Charged only on first-time
 * deliveries (a replayed requestId returns early), and reset when the
 * conversation settles (the settled pipeline calls `reset`, bots.settled.ts).
 */
export interface TurnBudget {
  count(conversationId: number): number;
  charge(conversationId: number): void;
  reset(conversationId: number): void;
}

/** One budget per runtime: the messaging store charges it, the settled pipeline resets it. */
const turnBudgets = new WeakMap<object, TurnBudget>();

export function turnBudgetOf(rt: object): TurnBudget {
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

/** The message a bot sees when another bot writes to it. */
export function botToBotText(fromName: string, text: string): string {
  return `**Message from ${fromName} (bot):** ${text}`;
}

/** What the store needs from the runtime: Deliveries. */
export type BotMessagingRuntime = DeliveryRuntime;

export function createBotMessagingStore(rt: BotMessagingRuntime): BotMessagingStore {
  /** The sending bot; `fromRoutine` when the send comes from one of its routine runs. */
  async function senderOf(conversationId: number) {
    const owner = await conversationOwner(conversationId);
    if (!owner) return null;
    return { id: owner.bot.id, name: owner.bot.name, fromRoutine: owner.kind === "routine" };
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

      // Exactly-once across pi-durable replays: a rerun of the tool task
      // recomputes the same requestId, so a replay returns early, uncharged
      // and unguarded; the guards below run for first-time deliveries only.
      const outcome = await deliveries.deliver<DeliverReason>(
        {
          requestId: input.requestId,
          kind: "send",
          toBotId: target.id,
          fromBotId: sender.id,
          // A routine run's message gets no relayed answer: it would land in
          // the bot's chat, which routine runs never write to (issue #63).
          replyToBotId: sender.fromRoutine ? null : sender.id,
          text: input.text,
          prompt: botToBotText(sender.name, sanitizePeerText(input.text)),
          peer: { kind: "message", name: sender.name },
          sourceKey: input.sourceKey,
        },
        async () => {
          // Per-turn budget (issue #16), then the loop guard.
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
      const rows = await db
        .select({
          name: bots.name,
          description: bots.description,
          conversationId: bots.conversationId,
        })
        .from(bots)
        .where(me ? ne(bots.id, me.id) : undefined)
        .orderBy(asc(bots.name));
      return rows.map(({ conversationId: botConversation, ...bot }) => ({
        ...bot,
        busy: rt.isBusy(conversationRef(botConversation)),
      }));
    },
  };
}
