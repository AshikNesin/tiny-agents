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
 * newly finished run as it lands (a `routine-run` bot chat event).
 */
import { and, desc, eq, gte, lt, ne } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { db, routineRuns, routines } from "../../db";
import { notifyRoutineRun, type RoutineOutcome } from "../notifications/notifications.wiring";
import type { RoutineRunRef } from "../notifications/notifications.events";
import type { RoutineRunCard } from "../../../shared/bot-stream";
import { publishBotChatEvent } from "../bots/bots.events";

export type { RoutineRunCard };

/** Cards one chat shows: the newest finished runs across the bot's routines. */
export const CHAT_CARDS = 50;

type CardRow = {
  id: string;
  routineId: string;
  status: string;
  trigger: string;
  scheduledFor: Date;
  finishedAt: Date | null;
  output: string | null;
  error: string | null;
  routineName: string;
};

function toCard(row: CardRow & { finishedAt: Date }): RoutineRunCard {
  return {
    id: row.id,
    routineId: row.routineId,
    routineName: row.routineName,
    // Cards are only built for finished runs (never `awaiting`).
    status: row.status as RoutineRunCard["status"],
    trigger: row.trigger as RoutineRunCard["trigger"],
    scheduledFor: row.scheduledFor.toISOString(),
    finishedAt: row.finishedAt.toISOString(),
    output: row.output,
    error: row.error,
  };
}

/** A run joined to its routine: the card's fields plus the bot it belongs to. */
const cardColumns = {
  id: routineRuns.id,
  routineId: routineRuns.routineId,
  status: routineRuns.status,
  trigger: routineRuns.trigger,
  scheduledFor: routineRuns.scheduledFor,
  finishedAt: routineRuns.finishedAt,
  output: routineRuns.output,
  error: routineRuns.error,
  routineName: routines.name,
  botId: routines.botId,
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
  const rows = await db
    .select(cardColumns)
    .from(routineRuns)
    .innerJoin(routines, eq(routineRuns.routineId, routines.id))
    .where(
      and(
        eq(routines.botId, botId),
        ne(routineRuns.status, "awaiting"),
        gte(routineRuns.finishedAt, since),
        until ? lt(routineRuns.finishedAt, until) : undefined,
      ),
    )
    .orderBy(desc(routineRuns.finishedAt))
    .limit(limit);
  return rows.reverse().map((row) => toCard({ ...row, finishedAt: row.finishedAt! }));
}

/** Send a run that just finished to the open chats of its bot. Best-effort. */
export async function publishRunCard(runId: string): Promise<void> {
  try {
    const [row] = await db
      .select(cardColumns)
      .from(routineRuns)
      .innerJoin(routines, eq(routineRuns.routineId, routines.id))
      .where(eq(routineRuns.id, runId))
      .limit(1);
    if (!row || row.status === "awaiting" || !row.finishedAt) return;
    const card = toCard({ ...row, finishedAt: row.finishedAt });
    publishBotChatEvent(row.botId, { type: "routine-run", run: card });
  } catch (error) {
    logger.warn({ error, runId }, "Failed to publish a routine run card");
  }
}

/** A run ended (watcher) or never started (fire job): push it and show its card. */
export function announceRun(ref: RoutineRunRef, outcome: RoutineOutcome): void {
  notifyRoutineRun(ref, outcome);
  void publishRunCard(ref.runId);
}
