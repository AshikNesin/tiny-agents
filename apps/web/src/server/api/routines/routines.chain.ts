/**
 * The routine chain: each armed routine has exactly one queued routine-fire
 * job for its next occurrence (`pendingJobId`, `nextRunAt`). Arming queues
 * it, an occurrence that fired queues the next, disarming cancels it, and the
 * boot re-arm gives a routine whose job is gone its job back.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { addJob, cancelJob } from "@groot/jobs/server/queue";
import type { SendJobOptions } from "@groot/jobs/server/types";
import { z } from "zod";
import { db, jobs, routineRuns, routines } from "../../db";
import { nextOccurrence, safeParseSchedule, type Schedule } from "./routines.schedule";

export const ROUTINE_FIRE_JOB = "routine-fire";

export const firePayloadSchema = z.object({
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

/** Cancel a queued fire job. Advisory: it may already have fired or been purged. */
export async function cancelPendingJob(pendingJobId: string | null): Promise<void> {
  if (!pendingJobId) return;
  try {
    await cancelJob(pendingJobId);
  } catch {
    // the job may already be gone; the row update is the durable part
  }
}

/** Disable the chain: cancel the queued job, clear the materialized slot. */
export async function disarmRoutine(id: string, pendingJobId: string | null): Promise<void> {
  await cancelPendingJob(pendingJobId);
  await db
    .update(routines)
    .set({ enabled: false, nextRunAt: null, pendingJobId: null })
    .where(eq(routines.id, id));
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
