/**
 * BotMessagingStore adapter: the agent's `bots` toolkit delivers messages
 * between bots through the app.db ledger. The store owns the submit into the
 * target's durable conversation, so the exactly-once boundary (requestId) and
 * the delivery receipt (deliveredAt) commit together.
 */
import { and, asc, eq, gte, ne } from "drizzle-orm";
import type { AgentRuntime } from "@tiny-agents/agent";
import { sanitizePeerText, type BotMessagingStore } from "@tiny-agents/agent";
import { db, botMessages, bots } from "../../db";
import { submitToBot } from "./bots.conversation";
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
  /** The sending bot; `fromRoutine` when the send comes from one of its routine runs. */
  async function senderOf(conversationId: number) {
    const owner = await conversationOwner(conversationId);
    if (!owner) return null;
    const bot = await db.query.bots.findFirst({
      where: eq(bots.id, owner.botId),
      columns: { id: true, name: true },
    });
    return bot ? { ...bot, fromRoutine: owner.routineId !== undefined } : null;
  }

  const turnBudget = createTurnBudget(rt);
  return {
    async deliver(input) {
      const sender = await senderOf(input.conversationId);
      if (!sender) return { delivered: false, reason: "unknown_bot" as DeliverReason };
      const target = await db.query.bots.findFirst({
        where: eq(bots.name, input.toName),
        columns: { id: true, name: true, conversationId: true },
      });
      if (!target) return { delivered: false, reason: "unknown_bot" };
      if (target.id === sender.id) return { delivered: false, reason: "self" };
      // Per-turn budget (issue #16): the idempotency check below must run
      // first so a replayed tool task returns early without being charged.
      const existing = await db.query.botMessages.findFirst({
        where: eq(botMessages.requestId, input.requestId),
        columns: { id: true },
      });
      if (existing) return { delivered: true };
      const sent = turnBudget.count(input.conversationId);
      if (sent >= TURN_LIMIT) return { delivered: false, reason: "budget" as DeliverReason };

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
      if (recent >= LOOP_LIMIT) return { delivered: false, reason: "loop" };

      // Exactly-once across pi-durable replays: a rerun of the tool task
      // recomputes the same requestId and sourceKey, so the row lands once
      // and the submit below is deduped by pi-durable itself (the early
      // return above is the replay path).
      const queued = rt.isBusy(Number(target.conversationId));
      await submitToBot(
        target.id,
        {
          requestId: input.requestId,
          text: botToBotText(sender.name, sanitizePeerText(input.text)),
          peer: { kind: "message", name: sender.name },
        },
        rt,
      );
      await db.insert(botMessages).values({
        fromBotId: sender.id,
        toBotId: target.id,
        // A routine run's message gets no relayed answer: it would land in
        // the bot's chat, which routine runs never write to (issue #63).
        replyToBotId: sender.fromRoutine ? null : sender.id,
        kind: "send",
        requestId: input.requestId,
        sourceKey: input.sourceKey,
        text: input.text,
        deliveredAt: new Date(),
      });
      turnBudget.charge(input.conversationId);
      return { delivered: true, ...(queued ? { queued: true } : {}) };
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
        busy: rt.isBusy(Number(botConversation)),
      }));
    },
  };
}
