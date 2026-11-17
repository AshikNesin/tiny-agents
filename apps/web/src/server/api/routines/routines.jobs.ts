/**
 * routine-fire: the scheduling engine's only job. Loads the routine, applies
 * the missed-run grace policy, skips the occurrence while an earlier run is
 * still working, submits the labeled prompt into a fresh durable
 * conversation of the run's own (never the bot's chat, never an earlier
 * run's, so a run's cost never grows with the routine's history), records
 * the run (routines.runs.ts) and advances the chain to the next occurrence
 * (routines.arming.ts).
 * Fast and LLM-free: the run resolves when its Finished reply lands
 * (routines.watcher.ts).
 */
import { and, eq } from "drizzle-orm";
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
  advanceRoutine,
  firePayloadSchema,
  setLatestConversation,
  type RoutineFirePayload,
} from "./routines.arming";
import {
  hasRunningRun,
  recentResults,
  recordAwaiting,
  recordMissed,
  recordSkipped,
  recordSubmitFailed,
  reserveRunConversation,
  runRequestId,
} from "./routines.runs";
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
      await advanceRoutine(routine, scheduledFor, now);
    }
    return existing.id;
  }

  if (!withinGrace(schedule, scheduledFor, now)) {
    const runId = await recordMissed(routine, scheduledFor, payload.trigger, now, lateMinutes);
    if (payload.trigger === "schedule" && routine.enabled) {
      await advanceRoutine(routine, now, now);
    }
    return runId;
  }

  const runtime = getAgentRuntime();
  // One run at a time: a fire while the last run still works is skipped,
  // not queued behind it (a redelivery of a reserved fire is not new).
  if (!existing && (await hasRunningRun(routine.id, runtime))) {
    const runId = await recordSkipped(routine, scheduledFor, payload.trigger, now);
    if (payload.trigger === "schedule" && routine.enabled) {
      await advanceRoutine(routine, scheduledFor, now);
    }
    return runId;
  }
  try {
    const conversationId = await runConversation(routine, scheduledFor, payload.trigger, runtime, {
      reserved: existing?.conversationId ?? null,
    });
    await submitToBot(
      routine.bot.id,
      {
        requestId: runRequestId(routine.id, scheduledFor),
        text: composeRoutinePrompt(
          routine.name,
          routine.prompt,
          scheduledFor,
          lateMinutes,
          await recentResults(routine.id, scheduledFor),
        ),
      },
      runtime,
      { routineConversationId: conversationId },
    );
  } catch (error) {
    // A model removed from the catalog fails the reconcile step, so it lands here too.
    return recordSubmitFailed(routine, scheduledFor, payload.trigger, now, error);
  }

  const runId = await recordAwaiting(routine, scheduledFor, payload.trigger, now);
  if (payload.trigger === "schedule") {
    await advanceRoutine(routine, scheduledFor, now);
  }
  return runId;
}

/**
 * The run's own conversation: a fresh one from the bot's config, so the run
 * pays only for its own prompt and tool calls, never for earlier runs. It is
 * recorded on the run before the submit, so a redelivered or retried fire
 * reuses it (and the request id dedupes the submit), and becomes the
 * routine's latest, which moves and deletes retire.
 */
async function runConversation(
  routine: { id: string; botId: string; name: string; bot: { id: string; name: string } },
  scheduledFor: Date,
  trigger: RoutineFirePayload["trigger"],
  runtime: BotConversationRuntime,
  { reserved }: { reserved: string | null },
): Promise<string> {
  if (reserved) return reserved;
  const created = await startBotConversation(routine.botId, runtime, { unattended: true });
  const conversationId = await reserveRunConversation(
    { id: routine.id, name: routine.name, bot: routine.bot },
    scheduledFor,
    trigger,
    created,
  );
  await setLatestConversation(routine.id, conversationId);
  return conversationId;
}

const routineFireHandler: JobHandler<RoutineFirePayload> = async ({ id, data }) => {
  const payload = firePayloadSchema.parse(data as unknown);
  await dispatchOccurrence(payload, new Date(), id);
};

export function registerRoutineJobs(): void {
  registerJobHandler(ROUTINE_FIRE_JOB, routineFireHandler);
}
