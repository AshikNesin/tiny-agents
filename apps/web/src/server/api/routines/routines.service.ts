import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { bots, db, routineRuns, routines } from "../../db";
import { routineRunMachine } from "../../../shared/machines/routine-run";
import { conversationRef } from "../bots/bots.conversation";
import { getAgentRuntime } from "../bots/bots.runtime";
import {
  armRoutine,
  createRoutine,
  disarmRoutine,
  moveToBot,
  removeRoutine,
} from "./routines.arming";
import { dispatchOccurrence } from "./routines.jobs";
import {
  MAX_ROUTINES,
  describeSchedule,
  isSpentOnce,
  nextOccurrence,
  safeParseSchedule,
  type Schedule,
} from "./routines.schedule";
import type { CreateRoutineDTO, UpdateRoutineDTO } from "./routines.schema";
import type {
  RecentRoutineRunData,
  RoutineData,
  RoutineRunData,
  Schedule as WireSchedule,
} from "../../../shared/api/routines";

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

function toApi(row: RoutineRow): RoutineData {
  const schedule = safeParseSchedule(row.schedule);
  return {
    id: row.id,
    botId: row.botId,
    botName: row.bot.name,
    name: row.name,
    prompt: row.prompt,
    schedule: row.schedule as WireSchedule,
    scheduleDescription: schedule ? describeSchedule(schedule) : "Unknown schedule",
    enabled: row.enabled,
    nextRunAt: row.nextRunAt,
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

async function retireConversation(conversationId: string | null): Promise<void> {
  if (!conversationId) return;
  try {
    await getAgentRuntime().abort(conversationRef(conversationId));
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

function assertFutureOnce(schedule: Schedule): void {
  if (isSpentOnce(schedule, new Date())) {
    throw Boom.badRequest("Pick a time in the future for a one-time routine");
  }
}

function assertCanArm(schedule: Schedule): void {
  if (isSpentOnce(schedule, new Date())) {
    throw Boom.badRequest("This one-time routine already ran. Pick a new time to run it again.");
  }
}

export async function create(
  input: CreateRoutineDTO & { sourceKey?: string },
): Promise<ReturnType<typeof toApi>> {
  await assertBotExists(input.botId);
  assertFutureOnce(input.schedule);
  const count = await db.$count(routines);
  if (count >= MAX_ROUTINES) {
    throw Boom.badRequest(`Routine limit reached (${MAX_ROUTINES})`);
  }
  const { id } = await createRoutine(
    {
      botId: input.botId,
      name: input.name,
      prompt: input.prompt,
      schedule: input.schedule,
      ...(input.sourceKey ? { sourceKey: input.sourceKey } : {}),
    },
    input.enabled,
  );
  return get(id);
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
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
      updatedAt: new Date(),
    })
    .where(eq(routines.id, id));
  if (botChanged) {
    await retireConversation(await moveToBot(id, input.botId!));
    await db
      .update(routineRuns)
      .set({ status: "cancelled", finishedAt: new Date(), error: "Moved to another bot" })
      .where(
        and(
          eq(routineRuns.routineId, id),
          inArray(routineRuns.status, routineRunMachine.sourcesOf("cancelled")),
        ),
      );
  }
  const scheduleChanged = input.schedule !== undefined;
  if (scheduleChanged || botChanged) {
    const schedule =
      input.schedule !== undefined ? input.schedule : safeParseSchedule(row.schedule);
    if (!schedule) throw Boom.badRequest("Routine has an invalid schedule");
    const wantsEnabled = input.enabled ?? row.enabled;
    if (wantsEnabled) await armRoutine(id, schedule, new Date());
    else await disarmRoutine(id);
  } else if (input.enabled !== undefined) {
    if (input.enabled && !row.enabled) {
      const schedule = safeParseSchedule(row.schedule);
      if (!schedule) throw Boom.badRequest("Routine has an invalid schedule");
      assertCanArm(schedule);
      await armRoutine(id, schedule, new Date());
    } else if (!input.enabled && row.enabled) {
      await disarmRoutine(id);
    }
  }
  return get(id);
}

export async function remove(id: string): Promise<void> {
  await findRoutine(id);
  await retireConversation(await removeRoutine(id));
}

export async function pause(id: string): Promise<ReturnType<typeof toApi>> {
  const row = await findRoutine(id);
  if (row.enabled) await disarmRoutine(id);
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

export async function runNow(id: string): Promise<{ runId: string }> {
  const row = await findRoutine(id);
  const now = new Date();
  const runId = await dispatchOccurrence(
    { routineId: row.id, scheduledFor: now.toISOString(), trigger: "manual" },
    now,
  );
  return { runId: runId ?? "" };
}

export async function listRuns(id: string, limit: number): Promise<RoutineRunData[]> {
  await findRoutine(id);
  const rows = await db
    .select()
    .from(routineRuns)
    .where(eq(routineRuns.routineId, id))
    .orderBy(desc(routineRuns.scheduledFor))
    .limit(limit);
  return rows;
}

export async function recentRuns(limit: number): Promise<RecentRoutineRunData[]> {
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
