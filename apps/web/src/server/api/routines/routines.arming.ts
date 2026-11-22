import { and, eq, gt, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";
import { createId } from "@groot/core/utils/id.utils";
import { logger } from "@groot/core/logger";
import { addJob, cancelJob } from "@groot/jobs/server/queue";
import type { SendJobOptions } from "@groot/jobs/server/types";
import { z } from "zod";
import { db, jobs, routineRuns, routines } from "../../db";
import {
  isClockSchedule,
  nextOccurrence,
  safeParseSchedule,
  type Schedule,
} from "./routines.schedule";

export const ROUTINE_FIRE_JOB = "routine-fire";

export const firePayloadSchema = z.object({
  routineId: z.string().min(1),
  scheduledFor: z.iso.datetime(),
  trigger: z.enum(["schedule", "manual", "webhook"]).default("schedule"),
});

export interface RoutineFirePayload extends z.infer<typeof firePayloadSchema> {}

export const BLOCKED_RUNS_BEFORE_PAUSE = 3;
const PAUSED_REASON_CHARS = 500;

const DISARMED = { enabled: false, nextRunAt: null, pendingJobId: null } as const;

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

export async function cancelFireJob(jobId: string | null | undefined): Promise<void> {
  if (!jobId) return;
  try {
    await cancelJob(jobId);
  } catch {}
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
  sourceKey?: string;
}

export async function createRoutine(
  fields: NewRoutine,
  armed: boolean,
  now: Date = new Date(),
): Promise<{ id: string; created: boolean }> {
  const id = createId();
  const nextRunAt =
    armed && isClockSchedule(fields.schedule) ? nextOccurrence(fields.schedule, now) : null;
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

export async function armRoutine(
  id: string,
  schedule: Schedule,
  from: Date,
  now: Date = new Date(),
): Promise<void> {
  const nextRunAt = isClockSchedule(schedule) ? nextOccurrence(schedule, from) : null;
  const pendingJobId = nextRunAt ? await queueFireJob(id, nextRunAt, now) : null;
  const before = await rewrite(id, () => ({
    enabled: true,
    nextRunAt,
    pendingJobId,
    blockedStreak: 0,
    pausedReason: null,
  }));
  if (!before) await cancelFireJob(pendingJobId);
}

export async function disarmRoutine(id: string): Promise<void> {
  await rewrite(id, () => DISARMED);
}

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

export interface ChainRoutine {
  id: string;
  schedule: unknown;
  pendingJobId: string | null;
}

export async function advanceRoutine(routine: ChainRoutine, from: Date, now: Date): Promise<void> {
  const schedule = safeParseSchedule(routine.schedule);
  if (!schedule || schedule.kind === "webhook") return;
  if (schedule.kind === "once") {
    await db
      .update(routines)
      .set(DISARMED)
      .where(and(eq(routines.id, routine.id), handleIs(routine.pendingJobId)));
    return;
  }
  await moveChain(routine.id, nextOccurrence(schedule, from), now, routine.pendingJobId);
}

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

export async function clearBlockedStreak(id: string): Promise<void> {
  await db
    .update(routines)
    .set({ blockedStreak: 0 })
    .where(and(eq(routines.id, id), gt(routines.blockedStreak, 0)));
}

export async function setLatestConversation(id: string, conversationId: string): Promise<void> {
  await db.update(routines).set({ conversationId }).where(eq(routines.id, id));
}

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

export function rearmRoutinesOnBoot(): Promise<void> {
  return rearmRoutines().then(
    () => undefined,
    (error: unknown) => logger.warn({ error }, "Failed to re-arm routines on boot"),
  );
}
