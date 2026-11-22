import { and, desc, eq, isNull } from "drizzle-orm";
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
import {
  bindEvents,
  composeEventsSection,
  hasPendingEvents,
  hookCapFreesAt,
  queueHookFire,
} from "./routines.hooks";

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
  if (payload.trigger === "webhook") return dispatchWebhook(routine, scheduledFor, now);

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
          routine.progress,
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

type DispatchRoutine = {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  enabled: boolean;
  progress: string | null;
  bot: { id: string; name: string };
};

async function dispatchWebhook(
  routine: DispatchRoutine,
  firedAt: Date,
  now: Date,
): Promise<string | undefined> {
  if (!routine.enabled) return undefined;
  const reserved = await db.query.routineRuns.findFirst({
    where: and(
      eq(routineRuns.routineId, routine.id),
      eq(routineRuns.trigger, "webhook"),
      eq(routineRuns.status, "awaiting"),
      isNull(routineRuns.submittedAt),
    ),
  });
  const runtime = getAgentRuntime();
  let scheduledFor = reserved?.scheduledFor ?? firedAt;
  if (!reserved) {
    if (await hasRunningRun(routine.id, runtime)) return undefined;
    const freesAt = await hookCapFreesAt(routine.id, now);
    if (freesAt) {
      await queueHookFire(routine.id, freesAt, now);
      return undefined;
    }
    if (!(await hasPendingEvents(routine.id))) return undefined;
    const latest = await db.query.routineRuns.findFirst({
      where: eq(routineRuns.routineId, routine.id),
      orderBy: desc(routineRuns.scheduledFor),
      columns: { scheduledFor: true },
    });
    if (latest && latest.scheduledFor.getTime() >= scheduledFor.getTime()) {
      scheduledFor = new Date(latest.scheduledFor.getTime() + 1);
    }
  }
  try {
    const conversationId = await runConversation(routine, scheduledFor, "webhook", runtime, {
      reserved: reserved?.conversationId ?? null,
    });
    const run = await db.query.routineRuns.findFirst({
      where: and(eq(routineRuns.routineId, routine.id), eq(routineRuns.scheduledFor, scheduledFor)),
      columns: { id: true },
    });
    if (!run) throw new Error("The webhook run could not be stored");
    const events = await bindEvents(routine.id, run.id);
    await submitToBot(
      routine.bot.id,
      {
        requestId: runRequestId(routine.id, scheduledFor),
        text:
          composeRoutinePrompt(
            routine.name,
            routine.prompt,
            scheduledFor,
            undefined,
            await recentResults(routine.id, scheduledFor),
            routine.progress,
          ) + composeEventsSection(events),
      },
      runtime,
      { unattendedConversationId: conversationId, unattended: "routine" },
    );
  } catch (error) {
    return recordSubmitFailed(routine, scheduledFor, "webhook", now, error);
  }
  return recordAwaiting(routine, scheduledFor, "webhook", now);
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
