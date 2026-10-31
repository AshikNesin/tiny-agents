/**
 * routine-fire: the scheduling engine's only job. Loads the routine, applies
 * the missed-run grace policy, inserts the exactly-once run row keyed by
 * (routineId, scheduledFor), submits the labeled prompt into the routine's
 * own durable conversation (issue #63: never the bot's chat), and schedules
 * the next occurrence. Fast and LLM-free: completion is the watcher's job
 * (routines.watcher.ts), and the result shows in the chat as a card
 * (routines.cards.ts).
 */
import { and, desc, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { addJob, cancelJob } from "@groot/jobs/server/queue";
import { registerJobHandler } from "@groot/jobs/server/worker";
import type { JobHandler, SendJobOptions } from "@groot/jobs/server/types";
import { z } from "zod";
import { db, jobs, routineRuns, routines } from "../../db";
import { getAgentRuntime } from "../bots/bots.runtime";
import {
  startBotConversation,
  submitToBot,
  type BotConversationRuntime,
} from "../bots/bots.conversation";
import { announceRun } from "./routines.cards";
import {
  composeRoutinePrompt,
  nextOccurrence,
  safeParseSchedule,
  withinGrace,
  type Schedule,
} from "./routines.schedule";

export const ROUTINE_FIRE_JOB = "routine-fire";
export const KEEP_RUNS_PER_ROUTINE = 50;

const firePayloadSchema = z.object({
  routineId: z.string().min(1),
  scheduledFor: z.iso.datetime(),
  trigger: z.enum(["schedule", "manual"]).default("schedule"),
});

export interface RoutineFirePayload extends z.infer<typeof firePayloadSchema> {}

/** Queue the fire job for one occurrence and point the routine's pending handle at it. */
async function queueFire(routineId: string, scheduledFor: Date, now: Date): Promise<void> {
  const delaySeconds = Math.max(0, Math.ceil((scheduledFor.getTime() - now.getTime()) / 1000));
  const options: SendJobOptions = { delaySeconds };
  const payload: RoutineFirePayload = {
    routineId,
    scheduledFor: scheduledFor.toISOString(),
    trigger: "schedule",
  };
  const jobId = await addJob(ROUTINE_FIRE_JOB, payload, options);
  await db
    .update(routines)
    .set({ nextRunAt: scheduledFor, pendingJobId: jobId })
    .where(eq(routines.id, routineId));
}

/** Queue the occurrence job and point the routine's pending handle at it. */
export async function enqueueOccurrence(
  routineId: string,
  schedule: Schedule,
  from: Date,
  now: Date,
): Promise<Date> {
  const next = nextOccurrence(schedule, from);
  await queueFire(routineId, next, now);
  return next;
}

/**
 * Advance a recurring routine after an occurrence fired, or archive a fired
 * once routine. `from` is the occurrence just handled for cron/interval (the
 * chain keeps its phase); a missed occurrence collapses the backlog by
 * scheduling the next live slot from now instead.
 */
export async function scheduleAfterOccurrence(
  routine: { id: string; schedule: unknown },
  from: Date,
  now: Date,
): Promise<void> {
  const schedule = safeParseSchedule(routine.schedule);
  if (!schedule) return;
  if (schedule.kind === "once") {
    await db
      .update(routines)
      .set({ enabled: false, nextRunAt: null, pendingJobId: null })
      .where(eq(routines.id, routine.id));
    return;
  }
  await enqueueOccurrence(routine.id, schedule, from, now);
}

/** Keep the run ledger bounded: newest KEEP_RUNS_PER_ROUTINE per routine. */
async function pruneRuns(routineId: string): Promise<void> {
  const keep = await db
    .select({ id: routineRuns.id })
    .from(routineRuns)
    .where(eq(routineRuns.routineId, routineId))
    .orderBy(desc(routineRuns.scheduledFor))
    .limit(KEEP_RUNS_PER_ROUTINE);
  if (keep.length < KEEP_RUNS_PER_ROUTINE) return;
  await db.delete(routineRuns).where(
    and(
      eq(routineRuns.routineId, routineId),
      notInArray(
        routineRuns.id,
        keep.map((run) => run.id),
      ),
    ),
  );
}

/** The run row of one occurrence, created or updated in place (the exactly-once key). */
async function upsertRun(
  create: {
    routineId: string;
    scheduledFor: Date;
    status: string;
    trigger: string;
    requestId: string;
    submittedAt?: Date;
    startedAt?: Date;
    finishedAt?: Date;
    error?: string;
  },
  update: Partial<{
    status: string;
    submittedAt: Date;
    startedAt: Date;
    finishedAt: Date;
    error: string | null;
  }>,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(routineRuns)
    .values(create)
    .onConflictDoUpdate({
      target: [routineRuns.routineId, routineRuns.scheduledFor],
      set: update,
    })
    .returning({ id: routineRuns.id });
  return row!;
}

/**
 * Fire one occurrence: create-or-reuse the run row, submit the labeled
 * prompt, mark it awaiting. Idempotent on every input, so a redelivered or
 * retried queue job cannot duplicate the run or the submitted turn (the
 * pi-durable requestId dedupes the submit itself). `jobId` is the queue job
 * delivering it, when there is one.
 */
export async function dispatchOccurrence(
  payload: RoutineFirePayload,
  now: Date = new Date(),
  jobId?: string,
): Promise<void> {
  const scheduledFor = new Date(payload.scheduledFor);
  const routine = await db.query.routines.findFirst({
    where: eq(routines.id, payload.routineId),
    with: { bot: { columns: { id: true, name: true } } },
  });
  // Missing routine (deleted bot cascades or routine delete): the queued job
  // is an orphan; ack and drop.
  if (!routine || !routine.bot) return;
  const schedule = safeParseSchedule(routine.schedule);
  if (!schedule) {
    logger.warn({ routineId: routine.id }, "Routine has an unparsable schedule; skipping fire");
    return;
  }
  // A paused routine has no live chain; a job racing pause is a phantom fire.
  if (!routine.enabled && payload.trigger === "schedule") return;

  const existing = await db.query.routineRuns.findFirst({
    where: and(eq(routineRuns.routineId, routine.id), eq(routineRuns.scheduledFor, scheduledFor)),
  });
  const alreadySubmitted = existing?.submittedAt != null;
  const lateMinutes = Math.max(0, Math.floor((now.getTime() - scheduledFor.getTime()) / 60_000));

  if (existing && alreadySubmitted) {
    // Redelivery of a completed dispatch: never resubmit, but repair a chain
    // whose next occurrence was never scheduled (crash between submit and
    // enqueue) so a single delivery cannot end a recurring routine. A job the
    // queue retried after such a crash is still the routine's pending handle.
    const chainStalled =
      !routine.pendingJobId || (jobId !== undefined && routine.pendingJobId === jobId);
    if (payload.trigger === "schedule" && routine.enabled && chainStalled) {
      await scheduleAfterOccurrence(routine, scheduledFor, now);
    }
    return;
  }

  if (!withinGrace(schedule, scheduledFor, now)) {
    const missed = await upsertRun(
      {
        routineId: routine.id,
        scheduledFor,
        status: "missed",
        trigger: payload.trigger,
        requestId: runRequestId(routine.id, scheduledFor),
        finishedAt: now,
        error: `Missed: ${lateMinutes}m past slot, beyond grace`,
      },
      { status: "missed", finishedAt: now },
    );
    announceRun(
      { runId: missed.id, routineName: routine.name, bot: routine.bot },
      { status: "missed", error: `Started ${lateMinutes} min late, past the grace window.` },
    );
    if (payload.trigger === "schedule" && routine.enabled) {
      await scheduleAfterOccurrence(routine, now, now);
    }
    return;
  }

  const runtime = getAgentRuntime();
  const bot = routine.bot;
  let submitted = true;
  try {
    const routineConversationId = await routineConversation(routine, runtime);
    await submitToBot(
      bot.id,
      {
        requestId: runRequestId(routine.id, scheduledFor),
        text: composeRoutinePrompt(routine.name, routine.prompt, scheduledFor, lateMinutes),
      },
      runtime,
      { routineConversationId },
    );
  } catch (error) {
    // Auth and configuration failures (model gone, gateway missing) must not
    // retry in a loop: the run fails once, the routine pauses, and the failed
    // run's card in the bot's chat says so (PRD 5.5). A model removed from
    // the catalog fails the reconcile step, so it lands here too.
    submitted = false;
    const failed = await upsertRun(
      {
        routineId: routine.id,
        scheduledFor,
        status: "failed",
        trigger: payload.trigger,
        requestId: runRequestId(routine.id, scheduledFor),
        finishedAt: now,
        error: pausedError(error),
      },
      { status: "failed", finishedAt: now, error: pausedError(error) },
    );
    await pauseAfterSubmitFailure(routine);
    announceRun(
      { runId: failed.id, routineName: routine.name, bot: { id: bot.id, name: bot.name } },
      { status: "paused", error: submitError(error) },
    );
  }

  if (!submitted) return;

  await upsertRun(
    {
      routineId: routine.id,
      scheduledFor,
      status: "awaiting",
      trigger: payload.trigger,
      requestId: runRequestId(routine.id, scheduledFor),
      submittedAt: now,
      startedAt: now,
    },
    { status: "awaiting", submittedAt: now, startedAt: now, error: null },
  );

  if (payload.trigger === "schedule") {
    await scheduleAfterOccurrence(routine, scheduledFor, now);
  }
  await pruneRuns(routine.id);
}

/** Stable submit id: one per (routine, occurrence), so replays dedupe. */
export function runRequestId(routineId: string, scheduledFor: Date): string {
  return `routine:${routineId}:${scheduledFor.toISOString()}`;
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

function submitError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Submit failed: ${message}`.slice(0, 500);
}

/** A failed submit's run error: the reason and that the routine is now paused. */
function pausedError(error: unknown): string {
  const paused = " The routine is paused: fix the bot's model or gateway, then resume it.";
  return `${submitError(error).slice(0, 500 - paused.length)}${paused}`;
}

/** Pause a routine whose submit failed; its failed run's card tells the owner. */
async function pauseAfterSubmitFailure(routine: {
  id: string;
  pendingJobId: string | null;
}): Promise<void> {
  try {
    if (routine.pendingJobId) {
      await cancelJob(routine.pendingJobId);
    }
  } catch {
    // the job may already be gone; the pause below is the durable part
  }
  await db
    .update(routines)
    .set({ enabled: false, nextRunAt: null, pendingJobId: null })
    .where(eq(routines.id, routine.id));
}

/**
 * Boot: give every armed routine whose fire job is gone its job back. An
 * enabled routine with a `nextRunAt` must have a live (created or active)
 * routine-fire job behind `pendingJobId`; after the move off the old queue
 * (`db/legacy-copy.ts` clears every handle) or a job that failed for good,
 * it has none and would never fire again.
 *
 * The occurrence it was waiting for is queued again as it stands: a future
 * one at its time, an overdue one at once, where `dispatchOccurrence`
 * applies the grace policy exactly as to a delivery delayed by downtime (a
 * late once still fires; a recurring slot past its grace is recorded missed
 * and the chain resumes from now). An occurrence that was already submitted
 * (a crash between its submit and the chain) is not fired twice: the chain
 * advances past it. Returns how many routines were re-armed.
 */
export async function rearmRoutines(now: Date = new Date()): Promise<number> {
  const armed = await db
    .select({
      id: routines.id,
      schedule: routines.schedule,
      nextRunAt: routines.nextRunAt,
      pendingJobId: routines.pendingJobId,
    })
    .from(routines)
    .where(and(eq(routines.enabled, true), isNotNull(routines.nextRunAt)));
  if (armed.length === 0) return 0;

  const handles = armed
    .map((routine) => routine.pendingJobId)
    .filter((id): id is string => id !== null);
  const live = new Set(
    handles.length === 0
      ? []
      : (
          await db
            .select({ id: jobs.id })
            .from(jobs)
            .where(
              and(
                inArray(jobs.id, handles),
                eq(jobs.name, ROUTINE_FIRE_JOB),
                inArray(jobs.state, ["created", "active"]),
              ),
            )
        ).map((job) => job.id),
  );

  let rearmed = 0;
  for (const routine of armed) {
    if (routine.pendingJobId && live.has(routine.pendingJobId)) continue;
    const scheduledFor = routine.nextRunAt!;
    try {
      if (!safeParseSchedule(routine.schedule)) {
        logger.warn({ routineId: routine.id }, "Routine has an unparsable schedule; not re-armed");
        continue;
      }
      const run = await db.query.routineRuns.findFirst({
        where: and(
          eq(routineRuns.routineId, routine.id),
          eq(routineRuns.scheduledFor, scheduledFor),
        ),
        columns: { submittedAt: true },
      });
      if (run?.submittedAt) {
        await scheduleAfterOccurrence(routine, scheduledFor, now);
      } else {
        await queueFire(routine.id, scheduledFor, now);
      }
      rearmed += 1;
    } catch (error) {
      logger.warn({ error, routineId: routine.id }, "Failed to re-arm a routine");
    }
  }
  if (rearmed > 0) logger.info({ rearmed }, "Re-armed routines whose fire job was gone");
  return rearmed;
}

export const routineFireHandler: JobHandler<RoutineFirePayload> = async ({ id, data }) => {
  const payload = firePayloadSchema.parse(data as unknown);
  await dispatchOccurrence(payload, new Date(), id);
};

export function registerRoutineJobs(): void {
  registerJobHandler(ROUTINE_FIRE_JOB, routineFireHandler);
}
