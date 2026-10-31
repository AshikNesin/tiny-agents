/**
 * routine-fire: the scheduling engine's only job. Loads the routine, applies
 * the missed-run grace policy, submits the labeled prompt into the routine's
 * own durable conversation (issue #63: never the bot's chat), records the run
 * (routines.runs.ts) and schedules the next occurrence (routines.chain.ts).
 * Fast and LLM-free: the run resolves when its Finished reply lands
 * (routines.watcher.ts).
 */
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { registerJobHandler } from "@groot/jobs/server/worker";
import type { JobHandler } from "@groot/jobs/server/types";
import { db, routineRuns, routines } from "../../db";
import { getAgentRuntime } from "../bots/bots.runtime";
import {
  startBotConversation,
  submitToBot,
  type BotConversationRuntime,
} from "../bots/bots.conversation";
import {
  ROUTINE_FIRE_JOB,
  firePayloadSchema,
  scheduleAfterOccurrence,
  type RoutineFirePayload,
} from "./routines.chain";
import { recordAwaiting, recordMissed, recordSubmitFailed, runRequestId } from "./routines.runs";
import { composeRoutinePrompt, safeParseSchedule, withinGrace } from "./routines.schedule";

/**
 * Fire one occurrence: submit the labeled prompt and record the run.
 * Idempotent on every input, so a redelivered or retried queue job cannot
 * duplicate the run or the submitted turn (the pi-durable requestId dedupes
 * the submit itself). `jobId` is the queue job delivering it, when there is
 * one. Returns the run's id, or undefined when nothing fired (orphan job,
 * paused routine, bad schedule).
 */
export async function dispatchOccurrence(
  payload: RoutineFirePayload,
  now: Date = new Date(),
  jobId?: string,
): Promise<string | undefined> {
  const scheduledFor = new Date(payload.scheduledFor);
  const routine = await db.query.routines.findFirst({
    where: eq(routines.id, payload.routineId),
    with: { bot: { columns: { id: true, name: true } } },
  });
  // Missing routine (deleted bot cascades or routine delete): the queued job
  // is an orphan; ack and drop.
  if (!routine || !routine.bot) return undefined;
  const schedule = safeParseSchedule(routine.schedule);
  if (!schedule) {
    logger.warn({ routineId: routine.id }, "Routine has an unparsable schedule; skipping fire");
    return undefined;
  }
  // A paused routine has no live chain; a job racing pause is a phantom fire.
  if (!routine.enabled && payload.trigger === "schedule") return undefined;

  const existing = await db.query.routineRuns.findFirst({
    where: and(eq(routineRuns.routineId, routine.id), eq(routineRuns.scheduledFor, scheduledFor)),
  });
  const lateMinutes = Math.max(0, Math.floor((now.getTime() - scheduledFor.getTime()) / 60_000));

  if (existing?.submittedAt != null) {
    // Redelivery of a completed dispatch: never resubmit, but repair a chain
    // whose next occurrence was never scheduled (crash between submit and
    // enqueue) so a single delivery cannot end a recurring routine. A job the
    // queue retried after such a crash is still the routine's pending handle.
    const chainStalled =
      !routine.pendingJobId || (jobId !== undefined && routine.pendingJobId === jobId);
    if (payload.trigger === "schedule" && routine.enabled && chainStalled) {
      await scheduleAfterOccurrence(routine, scheduledFor, now);
    }
    return existing.id;
  }

  if (!withinGrace(schedule, scheduledFor, now)) {
    const runId = await recordMissed(routine, scheduledFor, payload.trigger, now, lateMinutes);
    if (payload.trigger === "schedule" && routine.enabled) {
      await scheduleAfterOccurrence(routine, now, now);
    }
    return runId;
  }

  const runtime = getAgentRuntime();
  try {
    const routineConversationId = await routineConversation(routine, runtime);
    await submitToBot(
      routine.bot.id,
      {
        requestId: runRequestId(routine.id, scheduledFor),
        text: composeRoutinePrompt(routine.name, routine.prompt, scheduledFor, lateMinutes),
      },
      runtime,
      { routineConversationId },
    );
  } catch (error) {
    // A model removed from the catalog fails the reconcile step, so it lands here too.
    return recordSubmitFailed(routine, scheduledFor, payload.trigger, now, error);
  }

  const runId = await recordAwaiting(routine, scheduledFor, payload.trigger, now);
  if (payload.trigger === "schedule") {
    await scheduleAfterOccurrence(routine, scheduledFor, now);
  }
  return runId;
}

/**
 * The routine's own conversation (issue #63): created from the bot's config
 * on its first fire, then reused by every run, so a recurring routine still
 * sees what its earlier runs said. Two fires racing the first create keep
 * whichever stored first; the other's empty conversation is never used.
 */
async function routineConversation(
  routine: { id: string; botId: string; conversationId: string | null },
  runtime: BotConversationRuntime,
): Promise<string> {
  if (routine.conversationId) return routine.conversationId;
  const created = await startBotConversation(routine.botId, runtime, { unattended: true });
  const claimed = await db
    .update(routines)
    .set({ conversationId: created })
    .where(and(eq(routines.id, routine.id), isNull(routines.conversationId)))
    .returning({ id: routines.id });
  if (claimed.length === 1) return created;
  const row = await db.query.routines.findFirst({
    where: eq(routines.id, routine.id),
    columns: { conversationId: true },
  });
  if (!row?.conversationId) throw new Error("The routine's conversation could not be stored");
  return row.conversationId;
}

export const routineFireHandler: JobHandler<RoutineFirePayload> = async ({ id, data }) => {
  const payload = firePayloadSchema.parse(data as unknown);
  await dispatchOccurrence(payload, new Date(), id);
};

export function registerRoutineJobs(): void {
  registerJobHandler(ROUTINE_FIRE_JOB, routineFireHandler);
}
