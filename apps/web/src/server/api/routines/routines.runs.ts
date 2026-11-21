import { and, asc, desc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import { RUN_TOOL_CALL_LIMIT, type AgentRuntime, type FinishedReply } from "@tiny-agents/agent";
import { conversationRef } from "../bots/bots.conversation";
import { awaitedSubmissions } from "../bots/bots.awaited";
import type { ChatRead } from "../bots/bots.settled";
import { db, bots, routineRuns, routines, type RoutineRun } from "../../db";
import { ROUTINE_RUN_TOKEN_BUDGET } from "../bots/bots.conversation";
import {
  routineRunMachine,
  type RoutineRunStatus,
  type SettledRoutineRunStatus,
} from "../../../shared/machines/routine-run";
import type { RoutineRunRef } from "../notifications/notifications.events";
import { announceRun } from "./routines.cards";
import { clearBlockedStreak, disarmRoutine, recordBlocked } from "./routines.arming";

const KEEP_RUNS_PER_ROUTINE = 50;
const OUTPUT_PREVIEW_CHARS = 2000;
const ERROR_PREVIEW_CHARS = 500;

export type RoutineRunsRuntime = Pick<
  AgentRuntime,
  "isBusy" | "readChat" | "listCapabilities" | "usedTokens"
>;

export function runRequestId(routineId: string, scheduledFor: Date): string {
  return `routine:${routineId}:${scheduledFor.toISOString()}`;
}

export interface RunRoutine {
  id: string;
  name: string;
  bot: { id: string; name: string };
}

function preview(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

const refOf = (runId: string, routine: RunRoutine): RoutineRunRef => ({
  runId,
  routineName: routine.name,
  bot: { id: routine.bot.id, name: routine.bot.name },
});

async function upsertRun(
  routine: RunRoutine,
  scheduledFor: Date,
  trigger: RoutineRun["trigger"],
  fields: Partial<
    Pick<RoutineRun, "submittedAt" | "startedAt" | "finishedAt" | "error" | "conversationId">
  > & {
    status: (typeof routineRunMachine.initial)[number];
  },
): Promise<string> {
  const [row] = await db
    .insert(routineRuns)
    .values({
      routineId: routine.id,
      scheduledFor,
      trigger,
      requestId: runRequestId(routine.id, scheduledFor),
      ...fields,
    })
    .onConflictDoUpdate({
      target: [routineRuns.routineId, routineRuns.scheduledFor],
      set: fields,
    })
    .returning({ id: routineRuns.id });
  return row!.id;
}

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

export async function reserveRunConversation(
  routine: RunRoutine,
  scheduledFor: Date,
  trigger: RoutineRun["trigger"],
  created: string,
): Promise<string> {
  await db
    .insert(routineRuns)
    .values({
      routineId: routine.id,
      scheduledFor,
      trigger,
      requestId: runRequestId(routine.id, scheduledFor),
      status: "awaiting",
      conversationId: created,
    })
    .onConflictDoUpdate({
      target: [routineRuns.routineId, routineRuns.scheduledFor],
      set: { conversationId: sql`coalesce(${routineRuns.conversationId}, ${created})` },
    });
  const row = await db.query.routineRuns.findFirst({
    where: and(eq(routineRuns.routineId, routine.id), eq(routineRuns.scheduledFor, scheduledFor)),
    columns: { conversationId: true },
  });
  if (!row?.conversationId) throw new Error("The routine run's conversation could not be stored");
  return row.conversationId;
}

export async function recordSkipped(
  routine: RunRoutine,
  scheduledFor: Date,
  trigger: RoutineRun["trigger"],
  now: Date,
): Promise<string> {
  const error = "Skipped: the previous run was still working.";
  const runId = await upsertRun(routine, scheduledFor, trigger, {
    status: "missed",
    finishedAt: now,
    error,
  });
  announceRun(refOf(runId, routine), { status: "missed", error });
  return runId;
}

const RECENT_RESULTS = 3;
const RECENT_RESULT_CHARS = 500;

export async function recentResults(
  routineId: string,
  before: Date,
): Promise<{ scheduledFor: Date; output: string }[]> {
  const rows = await db
    .select({ scheduledFor: routineRuns.scheduledFor, output: routineRuns.output })
    .from(routineRuns)
    .where(
      and(
        eq(routineRuns.routineId, routineId),
        eq(routineRuns.status, "succeeded"),
        lt(routineRuns.scheduledFor, before),
      ),
    )
    .orderBy(desc(routineRuns.scheduledFor))
    .limit(RECENT_RESULTS);
  return rows.flatMap((row) =>
    row.output
      ? [{ scheduledFor: row.scheduledFor, output: preview(row.output, RECENT_RESULT_CHARS) }]
      : [],
  );
}

export async function hasRunningRun(
  routineId: string,
  rt: Pick<AgentRuntime, "isBusy">,
): Promise<boolean> {
  const awaiting = await db
    .select({ conversationId: routineRuns.conversationId })
    .from(routineRuns)
    .where(and(eq(routineRuns.routineId, routineId), eq(routineRuns.status, "awaiting")));
  return awaiting.some(
    (run) => run.conversationId !== null && rt.isBusy(conversationRef(run.conversationId)),
  );
}

export async function recordMissed(
  routine: RunRoutine,
  scheduledFor: Date,
  trigger: RoutineRun["trigger"],
  now: Date,
  lateMinutes: number,
): Promise<string> {
  const runId = await upsertRun(routine, scheduledFor, trigger, {
    status: "missed",
    finishedAt: now,
    error: `Missed: ${lateMinutes}m past slot, beyond grace`,
  });
  announceRun(refOf(runId, routine), {
    status: "missed",
    error: `Started ${lateMinutes} min late, past the grace window.`,
  });
  return runId;
}

function submitError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Submit failed: ${message}`.slice(0, 500);
}

function pausedError(error: unknown): string {
  const paused = " The routine is paused: fix the bot's model or gateway, then resume it.";
  return `${submitError(error).slice(0, 500 - paused.length)}${paused}`;
}

export async function recordSubmitFailed(
  routine: RunRoutine,
  scheduledFor: Date,
  trigger: RoutineRun["trigger"],
  now: Date,
  error: unknown,
): Promise<string> {
  const runId = await upsertRun(routine, scheduledFor, trigger, {
    status: "failed",
    finishedAt: now,
    error: pausedError(error),
  });
  await disarmRoutine(routine.id);
  announceRun(refOf(runId, routine), { status: "paused", error: submitError(error) });
  return runId;
}

export async function recordAwaiting(
  routine: RunRoutine,
  scheduledFor: Date,
  trigger: RoutineRun["trigger"],
  now: Date,
): Promise<string> {
  const runId = await upsertRun(routine, scheduledFor, trigger, {
    status: "awaiting",
    submittedAt: now,
    startedAt: now,
    error: null,
  });
  await pruneRuns(routine.id);
  return runId;
}

function overBudgetReason(tokens: number): string {
  const k = (value: number) => `${Math.round(value / 1000)}k`;
  return (
    `Used ${k(tokens)} tokens, over the ${k(ROUTINE_RUN_TOKEN_BUDGET)} budget a run gets, so it was ` +
    `stopped early. Make the prompt narrower (fewer pages, smaller results) or run it less often.`
  );
}

const RUN_CAP_REASON =
  `Made ${RUN_TOOL_CALL_LIMIT} tool calls, the most one run may make, so it was stopped early. ` +
  `Split the routine or ask for less per run.`;

const CREDENTIAL_TOOLS = new Set(["request_credentials"]);

export function refusalReason(tools: string[], askOnly: ReadonlySet<string>): string {
  const signIn = tools.filter((tool) => CREDENTIAL_TOOLS.has(tool));
  const rest = tools.filter((tool) => !CREDENTIAL_TOOLS.has(tool));
  const allowable = rest.filter((tool) => !askOnly.has(tool));
  const never = rest.filter((tool) => askOnly.has(tool));
  const list = (names: string[]) => names.map((name) => `\`${name}\``).join(", ");
  const parts: string[] = [];
  if (signIn.length > 0) {
    parts.push(
      "Needs a sign-in nobody can type during a routine run; save the login in the Vault and turn on Use in routines.",
    );
  }
  if (allowable.length > 0) {
    parts.push(
      `Needs approval for ${list(allowable)}; set ${allowable.length === 1 ? "it" : "them"} to Allow for this bot to use ${allowable.length === 1 ? "it" : "them"} in routines.`,
    );
  }
  if (never.length > 0) {
    parts.push(`${list(never)} always asks for approval, so routines can't use it.`);
  }
  return parts.join(" ");
}

async function settleRun(
  id: string,
  status: SettledRoutineRunStatus,
  data: Partial<Pick<RoutineRun, "error" | "output" | "tokens">>,
): Promise<void> {
  const from: RoutineRunStatus[] = routineRunMachine.sourcesOf(status);
  const updated = await db
    .update(routineRuns)
    .set({ ...data, status, finishedAt: new Date() })
    .where(and(eq(routineRuns.id, id), inArray(routineRuns.status, from)))
    .returning({ id: routineRuns.id });
  if (updated.length === 0) {
    throw new Error(`Routine run ${id} is gone or no longer ${from.join(" or ")}`);
  }
}

const awaitedConversation = sql<string>`coalesce(${routineRuns.conversationId}, ${routines.conversationId}, ${bots.conversationId})`;

async function awaitingRuns(conversationId?: number) {
  const rows = await db
    .select({
      id: routineRuns.id,
      routineId: routineRuns.routineId,
      requestId: routineRuns.requestId,
      routineName: routines.name,
      botId: bots.id,
      botName: bots.name,
      conversationId: awaitedConversation,
      ownConversation: routineRuns.conversationId,
    })
    .from(routineRuns)
    .innerJoin(routines, eq(routines.id, routineRuns.routineId))
    .innerJoin(bots, eq(bots.id, routines.botId))
    .where(
      and(
        eq(routineRuns.status, "awaiting"),
        conversationId === undefined ? undefined : eq(awaitedConversation, String(conversationId)),
      ),
    )
    .orderBy(asc(routineRuns.scheduledFor));
  return rows.map((row) => ({
    run: {
      id: row.id,
      routineId: row.routineId,
      requestId: row.requestId,
      ownConversation: row.ownConversation !== null,
    },
    conversationId: conversationRef(row.conversationId),
    ref: {
      runId: row.id,
      routineName: row.routineName,
      bot: { id: row.botId, name: row.botName },
    } satisfies RoutineRunRef,
  }));
}

export interface RoutineRunResolver {
  resolveConversation(conversationId: number, chat?: ChatRead): Promise<number>;
  bootSweep(): Promise<number>;
}

export function createRoutineRunResolver(rt: RoutineRunsRuntime): RoutineRunResolver {
  function askOnlyTools(): Set<string> {
    try {
      return new Set(
        rt
          .listCapabilities()
          .flatMap((capability) => capability.tools)
          .filter((tool) => tool.askOnly)
          .map((tool) => tool.name),
      );
    } catch {
      return new Set();
    }
  }

  async function runTokens(conversationId: number, own: boolean): Promise<number | undefined> {
    if (!own) return undefined;
    try {
      return await rt.usedTokens(conversationId);
    } catch {
      return undefined;
    }
  }

  async function resolveRun(
    ref: RoutineRunRef,
    run: { routineId: string; ownConversation: boolean },
    conversationId: number,
    reply: FinishedReply,
  ) {
    const routineId = run.routineId;
    const tokens = await runTokens(conversationId, run.ownConversation);
    const spent = tokens !== undefined ? { tokens } : {};
    const sentOf = reply.sent ? { sent: reply.sent } : {};
    if (reply.error !== undefined) {
      const error = preview(
        tokens !== undefined && tokens >= ROUTINE_RUN_TOKEN_BUDGET
          ? `${overBudgetReason(tokens)} ${reply.error}`
          : reply.error,
        ERROR_PREVIEW_CHARS,
      );
      await settleRun(ref.runId, "failed", { error, ...spent });
      await clearBlockedStreak(routineId);
      announceRun(ref, { status: "failed", error, ...sentOf });
      return;
    }
    const output = preview(reply.text, OUTPUT_PREVIEW_CHARS);
    const reasons = [
      tokens !== undefined && tokens >= ROUTINE_RUN_TOKEN_BUDGET
        ? overBudgetReason(tokens)
        : undefined,
      reply.stoppedBy === "runCap" ? RUN_CAP_REASON : undefined,
      reply.blocked,
      reply.refused?.length ? refusalReason(reply.refused, askOnlyTools()) : undefined,
    ].filter((reason): reason is string => reason !== undefined);
    if (reasons.length > 0) {
      const error = preview(reasons.join(" "), ERROR_PREVIEW_CHARS);
      await settleRun(ref.runId, "blocked", { error, output: output || null, ...spent });
      const pausedReason = await recordBlocked(routineId, error);
      announceRun(ref, { status: "blocked", error, pausedReason, ...sentOf });
      return;
    }
    await settleRun(ref.runId, "succeeded", { output, ...spent });
    await clearBlockedStreak(routineId);
    announceRun(ref, { status: "succeeded", output, ...sentOf });
  }

  async function markInterrupted(ref: RoutineRunRef): Promise<void> {
    await settleRun(ref.runId, "failed", { error: "interrupted" });
    announceRun(ref, { status: "failed", error: "Interrupted by a server restart." });
  }

  const awaited = awaitedSubmissions(rt, {
    name: "routine run",
    async pending(conversationId?: number) {
      return (await awaitingRuns(conversationId)).map((row) => ({
        ...row,
        requestId: row.run.requestId,
      }));
    },
    answered: ({ ref, run, conversationId }, reply) => resolveRun(ref, run, conversationId, reply),
    interrupted: ({ ref }) => markInterrupted(ref),
  });

  return { resolveConversation: awaited.answer, bootSweep: awaited.sweep };
}
