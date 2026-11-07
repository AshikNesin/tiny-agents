/**
 * A routine's armed state, and the only module that writes it: `enabled`,
 * `nextRunAt`, `pendingJobId` (the chain), `blockedStreak`, `pausedReason`,
 * `conversationId` and, at create, `sourceKey`. Every other routines file
 * asks for a transition here instead of writing those columns.
 *
 * An armed routine has exactly one queued routine-fire job for its next
 * occurrence (`pendingJobId`, `nextRunAt`). Each transition is one
 * compare-and-set statement, or one synchronous transaction where it must
 * read the handle it replaces; a queue job is added before the write that
 * points at it and cancelled when that write loses, and the handle a write
 * replaces is cancelled after it, so the row and the queue never keep two
 * chains:
 *
 *   createRoutine   one insert, already armed, carrying the sourceKey
 *   armRoutine      owner arms (create, resume, schedule edit): new chain,
 *                   blocked count starts over
 *   disarmRoutine   owner pauses, or a submit failed: no chain
 *   advanceRoutine  an occurrence fired: the next one, or a fired once ends;
 *                   only while the handle is still the one the fire loaded
 *   recordBlocked   a run ended blocked: count it, and pause in the same
 *                   write once BLOCKED_RUNS_BEFORE_PAUSE did in a row
 *   clearBlockedStreak  a run finished some other way
 *   claimConversation   first fire stores the routine's own conversation
 *   moveToBot       the routine's conversation is retired with its old bot
 *   removeRoutine   the row goes, and its queued job with it
 *   rearmRoutines   boot: an armed routine whose job is gone gets it back
 */
import { and, eq, gt, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";
import { createId } from "@groot/core/utils/id.utils";
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

/** Blocked runs in a row that pause a routine (issue #87). */
export const BLOCKED_RUNS_BEFORE_PAUSE = 3;
const PAUSED_REASON_CHARS = 500;

const DISARMED = { enabled: false, nextRunAt: null, pendingJobId: null } as const;

/** Queue the fire job for one occurrence. Points nothing at it yet. */
async function queueFireJob(routineId: string, scheduledFor: Date, now: Date): Promise<string> {
  const delaySeconds = Math.max(0, Math.ceil((scheduledFor.getTime() - now.getTime()) / 1000));
  const options: SendJobOptions = { delaySeconds };
  const payload: RoutineFirePayload = {
    routineId,
    scheduledFor: scheduledFor.toISOString(),
    trigger: "schedule",
  };
  return addJob(ROUTINE_FIRE_JOB, payload, options);
}

/** Cancel a queued fire job. Advisory: it may already have fired or been purged. */
export async function cancelFireJob(jobId: string | null | undefined): Promise<void> {
  if (!jobId) return;
  try {
    await cancelJob(jobId);
  } catch {
    // the job may already be gone; the row update is the durable part
  }
}

const handleIs = (jobId: string | null): SQL =>
  jobId === null ? isNull(routines.pendingJobId) : eq(routines.pendingJobId, jobId);

type ArmedFields = Partial<
  Pick<
    typeof routines.$inferInsert,
    "enabled" | "nextRunAt" | "pendingJobId" | "blockedStreak" | "pausedReason"
  >
>;

interface ArmedRow {
  enabled: boolean;
  pendingJobId: string | null;
  blockedStreak: number;
}

/**
 * The owner-driven write: read the row and write `change(row)` in one
 * synchronous transaction, then cancel the handle the write replaced. Returns
 * the row as it was, or undefined when the routine is gone.
 */
async function rewrite(
  id: string,
  change: (row: ArmedRow) => ArmedFields | undefined,
): Promise<ArmedRow | undefined> {
  const { before, fields } = db.transaction((tx) => {
    const row = tx
      .select({
        enabled: routines.enabled,
        pendingJobId: routines.pendingJobId,
        blockedStreak: routines.blockedStreak,
      })
      .from(routines)
      .where(eq(routines.id, id))
      .get();
    if (!row) return { before: undefined, fields: undefined };
    const next = change(row);
    if (next) tx.update(routines).set(next).where(eq(routines.id, id)).run();
    return { before: row, fields: next };
  });
  if (before && fields && "pendingJobId" in fields && fields.pendingJobId !== before.pendingJobId) {
    await cancelFireJob(before.pendingJobId);
  }
  return before;
}

export interface NewRoutine {
  botId: string;
  name: string;
  prompt: string;
  schedule: Schedule;
  /** Durable tool-call id: a replayed create returns the routine it made. */
  sourceKey?: string;
}

/**
 * Create a routine, armed or paused, in one insert that carries its
 * `sourceKey`, so a replay of the same tool call (even one after a crash
 * mid-create) finds the routine instead of making a second. Returns its id
 * and whether this call made it.
 */
export async function createRoutine(
  fields: NewRoutine,
  armed: boolean,
  now: Date = new Date(),
): Promise<{ id: string; created: boolean }> {
  const id = createId();
  const nextRunAt = armed ? nextOccurrence(fields.schedule, now) : null;
  const pendingJobId = nextRunAt ? await queueFireJob(id, nextRunAt, now) : null;
  const [row] = await db
    .insert(routines)
    .values({ id, ...fields, enabled: armed, nextRunAt, pendingJobId })
    .onConflictDoNothing({ target: routines.sourceKey })
    .returning({ id: routines.id });
  if (row) return { id: row.id, created: true };
  await cancelFireJob(pendingJobId);
  const existing = fields.sourceKey
    ? await db.query.routines.findFirst({
        where: eq(routines.sourceKey, fields.sourceKey),
        columns: { id: true },
      })
    : undefined;
  if (!existing) throw new Error("The routine could not be stored");
  return { id: existing.id, created: false };
}

/**
 * Arm a routine (create, resume, a schedule or bot edit): its next occurrence
 * from `from`, queued, any earlier chain cancelled. The queue is a table, so
 * arming always succeeds; the worker runs the job when it comes due. Arming
 * starts the blocked count over: the owner resumed it, presumably having
 * fixed what blocked it.
 */
export async function armRoutine(
  id: string,
  schedule: Schedule,
  from: Date,
  now: Date = new Date(),
): Promise<void> {
  const nextRunAt = nextOccurrence(schedule, from);
  const pendingJobId = await queueFireJob(id, nextRunAt, now);
  const before = await rewrite(id, () => ({
    enabled: true,
    nextRunAt,
    pendingJobId,
    blockedStreak: 0,
    pausedReason: null,
  }));
  if (!before) await cancelFireJob(pendingJobId);
}

/** Disarm a routine: cancel its queued job, clear the materialized slot. */
export async function disarmRoutine(id: string): Promise<void> {
  await rewrite(id, () => DISARMED);
}

/**
 * Point the chain at `scheduledFor` only while the routine is armed and its
 * handle is still `expected` (the one the caller loaded); otherwise the owner
 * re-armed or paused it meanwhile and the job just queued is cancelled.
 */
async function moveChain(
  routineId: string,
  scheduledFor: Date,
  now: Date,
  expected: string | null,
): Promise<boolean> {
  const pendingJobId = await queueFireJob(routineId, scheduledFor, now);
  const moved = await db
    .update(routines)
    .set({ nextRunAt: scheduledFor, pendingJobId })
    .where(and(eq(routines.id, routineId), eq(routines.enabled, true), handleIs(expected)))
    .returning({ id: routines.id });
  if (moved.length === 1) return true;
  await cancelFireJob(pendingJobId);
  return false;
}

/** The routine as an occurrence's fire (or the boot re-arm) loaded it. */
export interface ChainRoutine {
  id: string;
  schedule: unknown;
  pendingJobId: string | null;
}

/**
 * Advance a recurring routine after an occurrence fired, or end a fired once
 * routine. `from` is the occurrence just handled for cron/interval (the chain
 * keeps its phase); a missed occurrence collapses the backlog by scheduling
 * the next live slot from now instead. Compare-and-set on the handle the
 * caller loaded, so an edit or pause that landed meanwhile wins.
 */
export async function advanceRoutine(routine: ChainRoutine, from: Date, now: Date): Promise<void> {
  const schedule = safeParseSchedule(routine.schedule);
  if (!schedule) return;
  if (schedule.kind === "once") {
    await db
      .update(routines)
      .set(DISARMED)
      .where(and(eq(routines.id, routine.id), handleIs(routine.pendingJobId)));
    return;
  }
  await moveChain(routine.id, nextOccurrence(schedule, from), now, routine.pendingJobId);
}

/**
 * A run ended blocked: count it, and pause the routine in the same write once
 * BLOCKED_RUNS_BEFORE_PAUSE runs in a row have. Returns the paused reason when
 * this run paused it, else null; a routine that is already paused (a manual
 * run) only counts.
 */
export async function recordBlocked(id: string, reason: string): Promise<string | null> {
  let pausedReason: string | null = null;
  const before = await rewrite(id, (row) => {
    const blockedStreak = row.blockedStreak + 1;
    if (!row.enabled || blockedStreak < BLOCKED_RUNS_BEFORE_PAUSE) return { blockedStreak };
    pausedReason = `Paused after ${blockedStreak} blocked runs: ${reason}`.slice(
      0,
      PAUSED_REASON_CHARS,
    );
    return { ...DISARMED, blockedStreak, pausedReason };
  });
  if (!before) throw new Error(`Routine ${id} not found`);
  return pausedReason;
}

/** A run finished some other way: the blocked streak is broken. */
export async function clearBlockedStreak(id: string): Promise<void> {
  await db
    .update(routines)
    .set({ blockedStreak: 0 })
    .where(and(eq(routines.id, id), gt(routines.blockedStreak, 0)));
}

/**
 * Store `created` as the routine's own conversation (issue #63) unless one is
 * stored already. Two fires racing the first create keep whichever stored
 * first; returns that one, so the other's empty conversation is never used.
 */
export async function claimConversation(id: string, created: string): Promise<string> {
  const claimed = await db
    .update(routines)
    .set({ conversationId: created })
    .where(and(eq(routines.id, id), isNull(routines.conversationId)))
    .returning({ id: routines.id });
  if (claimed.length === 1) return created;
  const row = await db.query.routines.findFirst({
    where: eq(routines.id, id),
    columns: { conversationId: true },
  });
  if (!row?.conversationId) throw new Error("The routine's conversation could not be stored");
  return row.conversationId;
}

/**
 * Move a routine to another bot. Its conversation runs with the old bot's
 * persona and tools, so it is retired in the same write and the next fire
 * starts a fresh one. Returns the retired conversation, if there was one.
 */
export async function moveToBot(id: string, botId: string): Promise<string | null> {
  return db.transaction((tx) => {
    const row = tx
      .select({ conversationId: routines.conversationId })
      .from(routines)
      .where(eq(routines.id, id))
      .get();
    tx.update(routines).set({ botId, conversationId: null }).where(eq(routines.id, id)).run();
    return row?.conversationId ?? null;
  });
}

/**
 * Delete a routine and cancel its queued job. Returns its conversation, which
 * the caller retires, if it had one.
 */
export async function removeRoutine(id: string): Promise<string | null> {
  const row = db.transaction((tx) => {
    const found = tx
      .select({ pendingJobId: routines.pendingJobId, conversationId: routines.conversationId })
      .from(routines)
      .where(eq(routines.id, id))
      .get();
    tx.delete(routines).where(eq(routines.id, id)).run();
    return found;
  });
  await cancelFireJob(row?.pendingJobId);
  return row?.conversationId ?? null;
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
        await advanceRoutine(routine, scheduledFor, now);
      } else {
        await moveChain(routine.id, scheduledFor, now, routine.pendingJobId);
      }
      rearmed += 1;
    } catch (error) {
      logger.warn({ error, routineId: routine.id }, "Failed to re-arm a routine");
    }
  }
  if (rearmed > 0) logger.info({ rearmed }, "Re-armed routines whose fire job was gone");
  return rearmed;
}
