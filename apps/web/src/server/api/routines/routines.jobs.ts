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
  if (!routine || !routine.bot) return undefined;
  const schedule = safeParseSchedule(routine.schedule);
  if (!schedule) {
    logger.warn({ routineId: routine.id }, "Routine has an unparsable schedule; skipping fire");
    return undefined;
  }
  if (!routine.enabled && payload.trigger === "schedule") return undefined;

  const existing = await db.query.routineRuns.findFirst({
    where: and(eq(routineRuns.routineId, routine.id), eq(routineRuns.scheduledFor, scheduledFor)),
  });
  const lateMinutes = Math.max(0, Math.floor((now.getTime() - scheduledFor.getTime()) / 60_000));

  if (existing?.submittedAt != null) {
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
      { unattendedConversationId: conversationId, unattended: "routine" },
    );
  } catch (error) {
    return recordSubmitFailed(routine, scheduledFor, payload.trigger, now, error);
  }

  const runId = await recordAwaiting(routine, scheduledFor, payload.trigger, now);
  if (payload.trigger === "schedule") {
    await advanceRoutine(routine, scheduledFor, now);
  }
  return runId;
}

async function runConversation(
  routine: { id: string; botId: string; name: string; bot: { id: string; name: string } },
  scheduledFor: Date,
  trigger: RoutineFirePayload["trigger"],
  runtime: BotConversationRuntime,
  { reserved }: { reserved: string | null },
): Promise<string> {
  if (reserved) return reserved;
  const created = await startBotConversation(routine.botId, runtime, { unattended: "routine" });
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
