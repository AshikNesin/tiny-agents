/**
 * Routine CRUD + lifecycle over Drizzle. Thin: schedule math lives in
 * routines.schedule.ts, dispatch in routines.jobs.ts. Every mutation that can
 * move nextRunAt reconciles the pending queue job (cancel the old, enqueue
 * the new), so the queue and the row never disagree.
 *
 * Blocked runs (issue #87) count in `blockedStreak`; the third in a row
 * pauses the routine through the same disarm path as a manual pause and
 * records why in `pausedReason`. Arming it again (resume) starts over.
 */
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { cancelJob } from "@groot/jobs/server/queue";
import { bots, db, routineRuns, routines } from "../../db";
import { getAgentRuntime } from "../bots/bots.runtime";
import { ROUTINE_FIRE_JOB, dispatchOccurrence, enqueueOccurrence } from "./routines.jobs";
import {
  MAX_ROUTINES,
  describeSchedule,
  isSpentOnce,
  nextOccurrence,
  safeParseSchedule,
  type Schedule,
} from "./routines.schedule";
import type { CreateRoutineDTO, UpdateRoutineDTO } from "./routines.schema";

const routineWithBot = {
  bot: { columns: { id: true, name: true, conversationId: true } },
} as const;

type RoutineRow = {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  schedule: unknown;
  enabled: boolean;
  nextRunAt: Date | null;
  pendingJobId: string | null;
  conversationId: string | null;
  blockedStreak: number;
  pausedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  bot: { id: string; name: string; conversationId: string };
};

function toApi(row: RoutineRow) {
  const schedule = safeParseSchedule(row.schedule);
  return {
    id: row.id,
    botId: row.botId,
    botName: row.bot.name,
    name: row.name,
    prompt: row.prompt,
    schedule: row.schedule,
    scheduleDescription: schedule ? describeSchedule(schedule) : "Unknown schedule",
    enabled: row.enabled,
    nextRunAt: row.nextRunAt,
    // A one-time routine past its instant is finished, not paused.
    done: !row.enabled && schedule !== undefined && isSpentOnce(schedule, new Date()),
    blockedStreak: row.blockedStreak,
    pausedReason: row.pausedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findRoutine(id: string): Promise<RoutineRow> {
  const row = await db.query.routines.findFirst({
    where: eq(routines.id, id),
    with: routineWithBot,
  });
  if (!row) throw Boom.notFound("Routine not found");
  return row;
}

async function cancelPendingJob(pendingJobId: string | null): Promise<void> {
  if (!pendingJobId) return;
  try {
    await cancelJob({ queueName: ROUTINE_FIRE_JOB, jobId: pendingJobId });
  } catch {
    // The job may already have fired or been purged; cancellation is advisory.
  }
}

/**
 * Stop a routine's conversation the app no longer uses (the routine moved to
 * another bot, or is gone). Its history stays in agent.db, like a chat's after
 * "New chat"; a run still going there must not keep calling tools. Best effort.
 */
async function retireConversation(conversationId: string | null): Promise<void> {
  if (!conversationId) return;
  try {
    await getAgentRuntime().abort(Number(conversationId));
  } catch (error) {
    logger.warn({ error, conversationId }, "Failed to stop a retired routine conversation");
  }
}

async function assertBotExists(botId: string): Promise<void> {
  const bot = await db.query.bots.findFirst({
    where: eq(bots.id, botId),
    columns: { id: true },
  });
  if (!bot) throw Boom.badRequest("Bot not found");
}

/** Enable the chain: next occurrence from `from`, queued, handle stored.
 * The queue is a table, so arming always succeeds; the worker runs the job
 * when it comes due. Arming starts the blocked count over: the owner resumed
 * it, presumably having fixed what blocked it. */
async function armRoutine(id: string, schedule: Schedule, from: Date): Promise<void> {
  const now = new Date();
  const next = await enqueueOccurrence(id, schedule, from, now);
  await db
    .update(routines)
    .set({ enabled: true, nextRunAt: next, blockedStreak: 0, pausedReason: null })
    .where(eq(routines.id, id));
}

/** Disable the chain: cancel the queued job, clear the materialized slot. */
async function disarmRoutine(id: string, pendingJobId: string | null): Promise<void> {
  await cancelPendingJob(pendingJobId);
  await db
    .update(routines)
    .set({ enabled: false, nextRunAt: null, pendingJobId: null })
    .where(eq(routines.id, id));
}

export async function list(): Promise<ReturnType<typeof toApi>[]> {
  const rows = await db.query.routines.findMany({
    with: routineWithBot,
    orderBy: [desc(routines.enabled), asc(routines.nextRunAt), desc(routines.createdAt)],
  });
  return rows.map((row) => toApi(row));
}

export async function get(id: string): Promise<ReturnType<typeof toApi>> {
  return toApi(await findRoutine(id));
}

/** A one-time routine must point at the future when it is created or rescheduled. */
function assertFutureOnce(schedule: Schedule): void {
  if (isSpentOnce(schedule, new Date())) {
    throw Boom.badRequest("Pick a time in the future for a one-time routine");
  }
}

/** Re-enabling a one-time routine whose time has passed would arm a slot that already ran. */
function assertCanArm(schedule: Schedule): void {
  if (isSpentOnce(schedule, new Date())) {
    throw Boom.badRequest("This one-time routine already ran. Pick a new time to run it again.");
  }
}

export async function create(input: CreateRoutineDTO): Promise<ReturnType<typeof toApi>> {
  await assertBotExists(input.botId);
  assertFutureOnce(input.schedule);
  const count = await db.$count(routines);
  if (count >= MAX_ROUTINES) {
    throw Boom.badRequest(`Routine limit reached (${MAX_ROUTINES})`);
  }
  const [row] = await db
    .insert(routines)
    .values({
      botId: input.botId,
      name: input.name,
      prompt: input.prompt,
      schedule: input.schedule,
      enabled: false, // armed below once the queue job exists
    })
    .returning({ id: routines.id });
  if (input.enabled) {
    await armRoutine(row!.id, input.schedule, new Date());
  }
  return get(row!.id);
}

export async function update(
  id: string,
  input: UpdateRoutineDTO,
): Promise<ReturnType<typeof toApi>> {
  const row = await findRoutine(id);
  if (input.schedule !== undefined) assertFutureOnce(input.schedule);
  const botChanged = input.botId !== undefined && input.botId !== row.botId;
  if (botChanged) await assertBotExists(input.botId!);
  await db
    .update(routines)
    .set({
      ...(input.botId !== undefined ? { botId: input.botId } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
      // The conversation runs with the old bot's persona and tools: the next
      // fire starts a fresh one for the new bot.
      ...(botChanged ? { conversationId: null } : {}),
      // An `enabled`-only edit sets no field here; the row is still touched.
      updatedAt: new Date(),
    })
    .where(eq(routines.id, id));
  if (botChanged) {
    await retireConversation(row.conversationId);
    // A run still awaiting its reply there never gets one now.
    await db
      .update(routineRuns)
      .set({ status: "cancelled", finishedAt: new Date(), error: "Moved to another bot" })
      .where(and(eq(routineRuns.routineId, id), eq(routineRuns.status, "awaiting")));
  }
  const scheduleChanged = input.schedule !== undefined;
  if (scheduleChanged || botChanged) {
    // Any schedule-affecting edit re-arms from now; the old pending job dies.
    // `enabled` rides along so a schedule edit cannot silently re-enable a
    // paused routine.
    await cancelPendingJob(row.pendingJobId);
    const schedule =
      input.schedule !== undefined ? input.schedule : safeParseSchedule(row.schedule);
    if (!schedule) throw Boom.badRequest("Routine has an invalid schedule");
    const wantsEnabled = input.enabled ?? row.enabled;
    if (wantsEnabled) {
      await db
        .update(routines)
        .set({ pendingJobId: null, nextRunAt: null })
        .where(eq(routines.id, id));
      await armRoutine(id, schedule, new Date());
    } else {
      await db
        .update(routines)
        .set({ pendingJobId: null, nextRunAt: null, enabled: false })
        .where(eq(routines.id, id));
    }
  } else if (input.enabled !== undefined) {
    if (input.enabled && !row.enabled) {
      const schedule = safeParseSchedule(row.schedule);
      if (!schedule) throw Boom.badRequest("Routine has an invalid schedule");
      assertCanArm(schedule);
      await armRoutine(id, schedule, new Date());
    } else if (!input.enabled && row.enabled) {
      await disarmRoutine(id, row.pendingJobId);
    }
  }
  return get(id);
}

export async function remove(id: string): Promise<void> {
  const row = await findRoutine(id);
  await cancelPendingJob(row.pendingJobId);
  await db.delete(routines).where(eq(routines.id, id));
  await retireConversation(row.conversationId);
}

export async function pause(id: string): Promise<ReturnType<typeof toApi>> {
  const row = await findRoutine(id);
  if (row.enabled) await disarmRoutine(id, row.pendingJobId);
  return get(id);
}

export async function resume(id: string): Promise<ReturnType<typeof toApi>> {
  const row = await findRoutine(id);
  const schedule = safeParseSchedule(row.schedule);
  if (!schedule) throw Boom.badRequest("Routine has an invalid schedule");
  if (!row.enabled) {
    assertCanArm(schedule);
    await armRoutine(id, schedule, new Date());
  }
  return get(id);
}

/** Blocked runs in a row that pause a routine (issue #87). */
export const BLOCKED_RUNS_BEFORE_PAUSE = 3;
const PAUSED_REASON_CHARS = 500;

/**
 * A run of the routine ended blocked: count it, and pause the routine once
 * BLOCKED_RUNS_BEFORE_PAUSE runs in a row have. Returns the paused reason
 * when this run paused it (the caller notifies once), else null; a routine
 * that is already paused (a manual run) only counts.
 */
export async function recordBlockedRun(id: string, reason: string): Promise<string | null> {
  const [row] = await db
    .update(routines)
    .set({ blockedStreak: sql`${routines.blockedStreak} + 1` })
    .where(eq(routines.id, id))
    .returning({
      enabled: routines.enabled,
      pendingJobId: routines.pendingJobId,
      blockedStreak: routines.blockedStreak,
    });
  if (!row) throw Boom.notFound("Routine not found");
  if (!row.enabled || row.blockedStreak < BLOCKED_RUNS_BEFORE_PAUSE) return null;
  const pausedReason = `Paused after ${row.blockedStreak} blocked runs: ${reason}`.slice(
    0,
    PAUSED_REASON_CHARS,
  );
  await disarmRoutine(id, row.pendingJobId);
  await db.update(routines).set({ pausedReason }).where(eq(routines.id, id));
  return pausedReason;
}

/** A run of the routine finished some other way: the blocked streak is broken. */
export async function clearBlockedStreak(id: string): Promise<void> {
  await db
    .update(routines)
    .set({ blockedStreak: 0 })
    .where(and(eq(routines.id, id), gt(routines.blockedStreak, 0)));
}

/** Run now: a manual occurrence distinct from the scheduled chain (PRD 5.5). */
export async function runNow(id: string): Promise<{ runId: string }> {
  const row = await findRoutine(id);
  const now = new Date();
  const scheduledFor = new Date(now.getTime() - now.getMilliseconds());
  await dispatchOccurrence(
    { routineId: row.id, scheduledFor: scheduledFor.toISOString(), trigger: "manual" },
    now,
  );
  const run = await db.query.routineRuns.findFirst({
    where: and(eq(routineRuns.routineId, row.id), eq(routineRuns.scheduledFor, scheduledFor)),
    columns: { id: true },
  });
  return { runId: run?.id ?? "" };
}

export async function listRuns(id: string, limit: number) {
  await findRoutine(id);
  const rows = await db
    .select()
    .from(routineRuns)
    .where(eq(routineRuns.routineId, id))
    .orderBy(desc(routineRuns.scheduledFor))
    .limit(limit);
  return rows;
}

export async function recentRuns(limit: number) {
  const routineIds = await db.query.routines.findMany({
    columns: { id: true, name: true },
    with: { bot: { columns: { name: true } } },
  });
  const byId = new Map(routineIds.map((r) => [r.id, { name: r.name, botName: r.bot.name }]));
  const rows = await db
    .select()
    .from(routineRuns)
    .orderBy(desc(routineRuns.scheduledFor))
    .limit(limit * 2);
  return rows
    .filter((row) => byId.has(row.routineId))
    .map((row) => ({
      ...row,
      routineName: byId.get(row.routineId)!.name,
      botName: byId.get(row.routineId)!.botName,
    }))
    .slice(0, limit);
}

/** The next N fire times of a schedule from now, for previews and echoes (PRD 5.2). */
export function previewFireTimes(schedule: Schedule, from: Date, count = 3): Date[] {
  if (schedule.kind === "once") return [nextOccurrence(schedule, from)];
  const times: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    cursor = nextOccurrence(schedule, cursor);
    times.push(cursor);
  }
  return times;
}
