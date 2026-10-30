/**
 * Routine results in the bot's chat (issue #63). A routine runs in its own
 * conversation; the chat only shows each finished run as a card rendered
 * from its `RoutineRun` row (name, status, output preview, time), which the
 * client merges into the timeline. A card is not a transcript entry: it
 * costs no model turn and never reaches the bot's context.
 *
 * Cards belong to the chat thread they finished in: "New chat" starts a
 * clean thread (`Bot.chatStartedAt`), and older results stay on the Routines
 * page. The bot's chat stream sends the thread's cards on connect and each
 * newly finished run as it lands (`onRoutineCard`).
 */
import { prisma } from "@groot/core/database";
import { logger } from "@groot/core/logger";
import { notifyRoutineRun, type RoutineOutcome } from "../notifications/notifications.wiring";
import type { RoutineRunRef } from "../notifications/notifications.events";

/** Cards one chat shows: the newest finished runs across the bot's routines. */
export const CHAT_CARDS = 50;

/** A finished routine run as the chat renders it. */
export interface RoutineRunCard {
  id: string;
  routineId: string;
  routineName: string;
  status: string;
  trigger: string;
  scheduledFor: string;
  finishedAt: string;
  output: string | null;
  error: string | null;
}

type CardRow = {
  id: string;
  routineId: string;
  status: string;
  trigger: string;
  scheduledFor: Date;
  finishedAt: Date | null;
  output: string | null;
  error: string | null;
  routine: { name: string };
};

function toCard(row: CardRow & { finishedAt: Date }): RoutineRunCard {
  return {
    id: row.id,
    routineId: row.routineId,
    routineName: row.routine.name,
    status: row.status,
    trigger: row.trigger,
    scheduledFor: row.scheduledFor.toISOString(),
    finishedAt: row.finishedAt.toISOString(),
    output: row.output,
    error: row.error,
  };
}

const cardSelect = {
  id: true,
  routineId: true,
  status: true,
  trigger: true,
  scheduledFor: true,
  finishedAt: true,
  output: true,
  error: true,
  routine: { select: { name: true } },
} as const;

/**
 * The bot's routine runs that finished since its chat thread started, oldest
 * first. `until` bounds a past chat (issue #101) to the runs that finished
 * while it was the bot's chat.
 */
export async function chatCards(
  botId: string,
  since: Date,
  limit = CHAT_CARDS,
  until?: Date,
): Promise<RoutineRunCard[]> {
  const finishedAt = until ? { gte: since, lt: until } : { gte: since };
  const rows = await prisma.routineRun.findMany({
    where: { routine: { botId }, status: { not: "awaiting" }, finishedAt },
    orderBy: { finishedAt: "desc" },
    take: limit,
    select: cardSelect,
  });
  return rows.reverse().map((row) => toCard({ ...row, finishedAt: row.finishedAt! }));
}

type CardListener = (botId: string, card: RoutineRunCard) => void;
const listeners = new Set<CardListener>();

/** Follow finished runs (the chat stream filters by bot). Returns the unsubscribe. */
export function onRoutineCard(listener: CardListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Send a run that just finished to the open chats of its bot. Best-effort. */
export async function publishRunCard(runId: string): Promise<void> {
  try {
    const row = await prisma.routineRun.findUnique({
      where: { id: runId },
      select: { ...cardSelect, routine: { select: { name: true, botId: true } } },
    });
    if (!row || row.status === "awaiting" || !row.finishedAt) return;
    const card = toCard({ ...row, finishedAt: row.finishedAt });
    for (const listener of listeners) listener(row.routine.botId, card);
  } catch (error) {
    logger.warn({ error, runId }, "Failed to publish a routine run card");
  }
}

/** A run ended (watcher) or never started (fire job): push it and show its card. */
export function announceRun(ref: RoutineRunRef, outcome: RoutineOutcome): void {
  notifyRoutineRun(ref, outcome);
  void publishRunCard(ref.runId);
}
