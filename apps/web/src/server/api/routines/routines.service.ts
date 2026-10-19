/**
 * Routine CRUD + lifecycle over Prisma. Thin: schedule math lives in
 * routines.schedule.ts, dispatch in routines.jobs.ts. Every mutation that can
 * move nextRunAt reconciles the pending queue job (cancel the old, enqueue
 * the new), so the queue and the row never disagree.
 */
import { prisma } from "@groot/core/database";
import { Boom } from "@groot/core/errors";
import { cancelJob } from "@groot/jobs/server/queue";
import { jobQueueReady } from "@groot/jobs/server/client";
import { ROUTINE_FIRE_JOB, dispatchOccurrence, enqueueOccurrence } from "./routines.jobs";
import {
  MAX_ROUTINES,
  describeSchedule,
  nextOccurrence,
  safeParseSchedule,
  type Schedule,
} from "./routines.schedule";
import type { CreateRoutineDTO, UpdateRoutineDTO } from "./routines.schema";

const routineWithBot = { bot: { select: { id: true, name: true, conversationId: true } } } as const;

type RoutineRow = {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  schedule: unknown;
  enabled: boolean;
  nextRunAt: Date | null;
  pendingJobId: string | null;
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findRoutine(id: string): Promise<RoutineRow> {
  const row = await prisma.routine.findUnique({ where: { id }, include: routineWithBot });
  if (!row) throw Boom.notFound("Routine not found");
  return row as RoutineRow;
}

async function cancelPendingJob(pendingJobId: string | null): Promise<void> {
  if (!pendingJobId) return;
  try {
    await cancelJob({ queueName: ROUTINE_FIRE_JOB, jobId: pendingJobId });
  } catch {
    // The job may already have fired or been purged; cancellation is advisory.
  }
}

async function assertBotExists(botId: string): Promise<void> {
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { id: true } });
  if (!bot) throw Boom.badRequest("Bot not found");
}

function assertQueueReady(): void {
  if (!jobQueueReady()) {
    throw Boom.unavailable(
      "Job queue is disabled (set jobs.enabled=true in config.yml and restart) " +
        "so scheduled routines cannot run",
    );
  }
}

/** Enable the chain: next occurrence from `from`, queued, handle stored.
 * Arming needs the queue; a boot without it (jobs.enabled false) fails with
 * how to fix instead of an internal error. */
async function armRoutine(id: string, schedule: Schedule, from: Date): Promise<void> {
  assertQueueReady();
  const now = new Date();
  const next = await enqueueOccurrence(id, schedule, from, now);
  await prisma.routine.update({
    where: { id },
    data: { enabled: true, nextRunAt: next },
  });
}

/** Disable the chain: cancel the queued job, clear the materialized slot. */
async function disarmRoutine(id: string, pendingJobId: string | null): Promise<void> {
  await cancelPendingJob(pendingJobId);
  await prisma.routine.update({
    where: { id },
    data: { enabled: false, nextRunAt: null, pendingJobId: null },
  });
}

export async function list(): Promise<ReturnType<typeof toApi>[]> {
  const rows = await prisma.routine.findMany({
    include: routineWithBot,
    orderBy: [{ enabled: "desc" }, { nextRunAt: "asc" }, { createdAt: "desc" }],
  });
  return rows.map((row) => toApi(row as RoutineRow));
}

export async function get(id: string): Promise<ReturnType<typeof toApi>> {
  return toApi(await findRoutine(id));
}

export async function create(input: CreateRoutineDTO): Promise<ReturnType<typeof toApi>> {
  await assertBotExists(input.botId);
  const count = await prisma.routine.count();
  if (count >= MAX_ROUTINES) {
    throw Boom.badRequest(`Routine limit reached (${MAX_ROUTINES})`);
  }
  // Precondition, not cleanup: a create that cannot arm must not leave a
  // disabled orphan row behind when the arm step throws.
  if (input.enabled) assertQueueReady();
  const row = await prisma.routine.create({
    data: {
      botId: input.botId,
      name: input.name,
      prompt: input.prompt,
      schedule: input.schedule,
      enabled: false, // armed below once the queue job exists
    },
  });
  if (input.enabled) {
    await armRoutine(row.id, input.schedule, new Date());
  }
  return get(row.id);
}

export async function update(
  id: string,
  input: UpdateRoutineDTO,
): Promise<ReturnType<typeof toApi>> {
  const row = await findRoutine(id);
  if (input.botId !== undefined && input.botId !== row.botId) await assertBotExists(input.botId);
  await prisma.routine.update({
    where: { id },
    data: {
      ...(input.botId !== undefined ? { botId: input.botId } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
    },
  });
  const scheduleChanged = input.schedule !== undefined;
  const botChanged = input.botId !== undefined && input.botId !== row.botId;
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
      await prisma.routine.update({
        where: { id },
        data: { pendingJobId: null, nextRunAt: null },
      });
      await armRoutine(id, schedule, new Date());
    } else {
      await prisma.routine.update({
        where: { id },
        data: { pendingJobId: null, nextRunAt: null, enabled: false },
      });
    }
  } else if (input.enabled !== undefined) {
    if (input.enabled && !row.enabled) {
      const schedule = safeParseSchedule(row.schedule);
      if (!schedule) throw Boom.badRequest("Routine has an invalid schedule");
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
  await prisma.routine.delete({ where: { id } });
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
  if (!row.enabled) await armRoutine(id, schedule, new Date());
  return get(id);
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
  const run = await prisma.routineRun.findUnique({
    where: { routineId_scheduledFor: { routineId: row.id, scheduledFor } },
    select: { id: true },
  });
  return { runId: run?.id ?? "" };
}

export async function listRuns(id: string, limit: number) {
  await findRoutine(id);
  const rows = await prisma.routineRun.findMany({
    where: { routineId: id },
    orderBy: { scheduledFor: "desc" },
    take: limit,
  });
  return rows;
}

export async function recentRuns(limit: number) {
  const routineIds = await prisma.routine.findMany({
    select: { id: true, name: true, bot: { select: { name: true } } },
  });
  const byId = new Map(routineIds.map((r) => [r.id, { name: r.name, botName: r.bot.name }]));
  const rows = await prisma.routineRun.findMany({
    orderBy: { scheduledFor: "desc" },
    take: limit * 2,
  });
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
  const times: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    cursor = nextOccurrence(schedule, cursor);
    times.push(cursor);
  }
  return times;
}
