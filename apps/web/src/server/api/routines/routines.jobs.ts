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

/** Queue the occurrence job and point the routine's pending handle at it. */
export async function enqueueOccurrence(
  routineId: string,
  schedule: Schedule,
  from: Date,
  now: Date,
): Promise<Date> {
  const next = nextOccurrence(schedule, from);
  const delaySeconds = Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 1000));
  const options: SendJobOptions = { delaySeconds };
  const jobId = await addJob(
    ROUTINE_FIRE_JOB,
    { routineId, scheduledFor: next.toISOString(), trigger: "schedule" },
    options,
  );
  await prisma.routine.update({
    where: { id: routineId },
    data: { nextRunAt: next, ...(jobId ? { pendingJobId: jobId } : {}) },
  });
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
    await prisma.routine.update({
      where: { id: routine.id },
      data: { enabled: false, nextRunAt: null, pendingJobId: null },
    });
    return;
  }
  await enqueueOccurrence(routine.id, schedule, from, now);
}

/** Keep the run ledger bounded: newest KEEP_RUNS_PER_ROUTINE per routine. */
async function pruneRuns(routineId: string): Promise<void> {
  const keep = await prisma.routineRun.findMany({
    where: { routineId },
    orderBy: { scheduledFor: "desc" },
    take: KEEP_RUNS_PER_ROUTINE,
    select: { id: true },
  });
  if (keep.length < KEEP_RUNS_PER_ROUTINE) return;
  await prisma.routineRun.deleteMany({
    where: { routineId, id: { notIn: keep.map((run) => run.id) } },
  });
}

/**
 * Fire one occurrence: create-or-reuse the run row, submit the labeled
 * prompt, mark it awaiting. Idempotent on every input, so a redelivered or
 * retried queue job cannot duplicate the run or the submitted turn (the
 * pi-durable requestId dedupes the submit itself).
 */
export async function dispatchOccurrence(
  payload: RoutineFirePayload,
  now: Date = new Date(),
): Promise<void> {
  const scheduledFor = new Date(payload.scheduledFor);
  const routine = await prisma.routine.findUnique({
    where: { id: payload.routineId },
    include: { bot: { select: { id: true, name: true } } },
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

  const existing = await prisma.routineRun.findUnique({
    where: { routineId_scheduledFor: { routineId: routine.id, scheduledFor } },
  });
  const alreadySubmitted = existing?.submittedAt != null;
  const lateMinutes = Math.max(0, Math.floor((now.getTime() - scheduledFor.getTime()) / 60_000));

  if (existing && alreadySubmitted) {
    // Redelivery of a completed dispatch: never resubmit, but repair a chain
    // whose next occurrence was never scheduled (crash between submit and
    // enqueue) so a single delivery cannot end a recurring routine.
    if (payload.trigger === "schedule" && routine.enabled && !routine.pendingJobId) {
      await scheduleAfterOccurrence(routine, scheduledFor, now);
    }
    return;
  }

  if (!withinGrace(schedule, scheduledFor, now)) {
    const missed = await prisma.routineRun.upsert({
      where: { routineId_scheduledFor: { routineId: routine.id, scheduledFor } },
      create: {
        routineId: routine.id,
        scheduledFor,
        status: "missed",
        trigger: payload.trigger,
        requestId: runRequestId(routine.id, scheduledFor),
        finishedAt: now,
        error: `Missed: ${lateMinutes}m past slot, beyond grace`,
      },
      update: { status: "missed", finishedAt: now },
    });
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
    const failed = await prisma.routineRun.upsert({
      where: { routineId_scheduledFor: { routineId: routine.id, scheduledFor } },
      create: {
        routineId: routine.id,
        scheduledFor,
        status: "failed",
        trigger: payload.trigger,
        requestId: runRequestId(routine.id, scheduledFor),
        finishedAt: now,
        error: pausedError(error),
      },
      update: { status: "failed", finishedAt: now, error: pausedError(error) },
    });
    await pauseAfterSubmitFailure(routine);
    announceRun(
      { runId: failed.id, routineName: routine.name, bot: { id: bot.id, name: bot.name } },
      { status: "paused", error: submitError(error) },
    );
  }

  if (!submitted) return;

  await prisma.routineRun.upsert({
    where: { routineId_scheduledFor: { routineId: routine.id, scheduledFor } },
    create: {
      routineId: routine.id,
      scheduledFor,
      status: "awaiting",
      trigger: payload.trigger,
      requestId: runRequestId(routine.id, scheduledFor),
      submittedAt: now,
      startedAt: now,
    },
    update: { status: "awaiting", submittedAt: now, startedAt: now, error: null },
  });

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
  const claimed = await prisma.routine.updateMany({
    where: { id: routine.id, conversationId: null },
    data: { conversationId: created },
  });
  if (claimed.count === 1) return created;
  const row = await prisma.routine.findUnique({
    where: { id: routine.id },
    select: { conversationId: true },
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
      await cancelJob({ queueName: ROUTINE_FIRE_JOB, jobId: routine.pendingJobId });
    }
  } catch {
    // the job may already be gone; the pause below is the durable part
  }
  await prisma.routine.update({
    where: { id: routine.id },
    data: { enabled: false, nextRunAt: null, pendingJobId: null },
  });
}

export const routineFireHandler: JobHandler<RoutineFirePayload> = async ({
  data,
}: {
  data: RoutineFirePayload;
}) => {
  const payload = firePayloadSchema.parse(data as unknown);
  await dispatchOccurrence(payload);
};

export function registerRoutineJobs(): void {
  registerJobHandler(ROUTINE_FIRE_JOB, routineFireHandler);
}
