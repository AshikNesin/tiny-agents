/**
 * Routine runs: one run of routine R at slot S, from the fire to its card.
 * This module writes the moves of the routine-run machine
 * (`shared/machines/routine-run.ts`, which draws the graph) and what follows
 * from them: a blocked run counts toward pausing its routine (three in a
 * row, issue #87); a failed submit pauses it at once. Every move out of
 * `awaiting` is a compare-and-set, so a run is resolved and announced once
 * even when the idle listener and the boot sweep race, and a cancelled run
 * is never overwritten by a late reply.
 *
 * An awaiting run is answered by the Finished reply to its request id in the
 * routine's own conversation (issue #63), so a mid-turn message never stands
 * in for the answer and two queued runs never swap replies. Every finished
 * run is announced: a push notification and a card in its bot's chat.
 */
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { finishedReplyTo, type AgentRuntime, type FinishedReply } from "@tiny-agents/agent";
import { conversationRef } from "../bots/bots.conversation";
import type { ChatRead } from "../bots/bots.settled";
import { db, bots, routineRuns, routines, type RoutineRun } from "../../db";
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

/** Minimal runtime surface run resolution needs (the full AgentRuntime satisfies it). */
export type RoutineRunsRuntime = Pick<AgentRuntime, "isBusy" | "readChat" | "listCapabilities">;

/** Stable submit id: one per (routine, occurrence), so replays dedupe. */
export function runRequestId(routineId: string, scheduledFor: Date): string {
  return `routine:${routineId}:${scheduledFor.toISOString()}`;
}

/** The routine a run belongs to, as the fire job loaded it. */
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

/** The run row of one occurrence, created or updated in place (the exactly-once key). */
async function upsertRun(
  routine: RunRoutine,
  scheduledFor: Date,
  trigger: string,
  fields: Partial<Pick<RoutineRun, "submittedAt" | "startedAt" | "finishedAt" | "error">> & {
    /** Only a state a run may be recorded in at its fire. */
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

/** Keep the run ledger bounded: newest KEEP_RUNS_PER_ROUTINE per routine. */
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

/** The occurrence fired past its grace window: recorded missed, never submitted. */
export async function recordMissed(
  routine: RunRoutine,
  scheduledFor: Date,
  trigger: string,
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

/** A failed submit's run error: the reason and that the routine is now paused. */
function pausedError(error: unknown): string {
  const paused = " The routine is paused: fix the bot's model or gateway, then resume it.";
  return `${submitError(error).slice(0, 500 - paused.length)}${paused}`;
}

/**
 * The submit failed (model gone, gateway missing): the run fails once and
 * the routine pauses rather than retrying in a loop (PRD 5.5); the failed
 * run's card says so.
 */
export async function recordSubmitFailed(
  routine: RunRoutine,
  scheduledFor: Date,
  trigger: string,
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

/** The prompt is in the routine's conversation: the run awaits its Finished reply. */
export async function recordAwaiting(
  routine: RunRoutine,
  scheduledFor: Date,
  trigger: string,
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

/** Tools that ask the owner to type a sign-in: refused unattended, never allowable. */
const CREDENTIAL_TOOLS = new Set(["request_credentials"]);

/** Why a run was blocked on refused tools, telling the owner how to let them run. */
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

/**
 * Move one run to `status`, only from a state the machine allows. Throws
 * when no row moved (its routine was deleted, it was cancelled, or another
 * resolver settled it first), so the caller skips the announcement.
 */
async function settleRun(
  id: string,
  status: SettledRoutineRunStatus,
  data: Partial<Pick<RoutineRun, "error" | "output">>,
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

/** The conversation a run awaits (runs fired before routines had their own awaited the chat). */
const awaitedConversation = sql<string>`coalesce(${routines.conversationId}, ${bots.conversationId})`;

/** Awaiting runs, oldest slot first: every one, or only those awaiting one conversation. */
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
    run: { id: row.id, routineId: row.routineId, requestId: row.requestId },
    conversationId: conversationRef(row.conversationId),
    ref: {
      runId: row.id,
      routineName: row.routineName,
      bot: { id: row.botId, name: row.botName },
    } satisfies RoutineRunRef,
  }));
}

export interface RoutineRunResolver {
  /**
   * Resolve the awaiting runs of one conversation that just went idle.
   * `chat` is its state when the caller already read it.
   */
  resolveConversation(conversationId: number, chat?: ChatRead): Promise<number>;
  /** Boot: awaiting runs on already-idle conversations were interrupted by the restart. */
  bootSweep(): Promise<number>;
}

export function createRoutineRunResolver(rt: RoutineRunsRuntime): RoutineRunResolver {
  /** Tools that can never be set to Allow (`askOnly`). */
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

  async function resolveRun(ref: RoutineRunRef, routineId: string, reply: FinishedReply) {
    if (reply.error !== undefined) {
      const error = preview(reply.error, ERROR_PREVIEW_CHARS);
      await settleRun(ref.runId, "failed", { error });
      await clearBlockedStreak(routineId);
      announceRun(ref, { status: "failed", error });
      return;
    }
    const output = preview(reply.text, OUTPUT_PREVIEW_CHARS);
    const reasons = [
      reply.blocked,
      reply.refused?.length ? refusalReason(reply.refused, askOnlyTools()) : undefined,
    ].filter((reason): reason is string => reason !== undefined);
    if (reasons.length > 0) {
      const error = preview(reasons.join(" "), ERROR_PREVIEW_CHARS);
      await settleRun(ref.runId, "blocked", { error, output: output || null });
      const pausedReason = await recordBlocked(routineId, error);
      announceRun(ref, { status: "blocked", error, pausedReason });
      return;
    }
    await settleRun(ref.runId, "succeeded", { output });
    await clearBlockedStreak(routineId);
    announceRun(ref, { status: "succeeded", output });
  }

  async function markInterrupted(ref: RoutineRunRef): Promise<void> {
    await settleRun(ref.runId, "failed", { error: "interrupted" });
    announceRun(ref, { status: "failed", error: "Interrupted by a server restart." });
  }

  async function resolveConversation(
    conversationId: number,
    chat: ChatRead = () => rt.readChat(conversationId),
  ): Promise<number> {
    const runs = await awaitingRuns(conversationId);
    if (runs.length === 0) return 0;
    const state = await chat();
    let resolved = 0;
    for (const { run, ref } of runs) {
      try {
        const outcome = finishedReplyTo(state, run.requestId);
        // Not finished, or not placed in the transcript yet: a later idle
        // resolves it (the boot sweep settles any that never will).
        if (outcome.status !== "answered") continue;
        await resolveRun(ref, run.routineId, outcome.reply);
        resolved += 1;
      } catch (error) {
        logger.warn({ error, runId: run.id }, "Failed to resolve an awaiting routine run");
      }
    }
    return resolved;
  }

  async function bootSweep(): Promise<number> {
    let resolved = 0;
    for (const { run, conversationId, ref } of await awaitingRuns()) {
      // Idle at boot: the reply may have finished just before the restart
      // (resolve it), or never will (interrupted). A busy conversation may
      // still be finishing its turn; the idle listener resolves it later.
      if (rt.isBusy(conversationId)) continue;
      try {
        const outcome = finishedReplyTo(await rt.readChat(conversationId), run.requestId);
        if (outcome.status === "answered") await resolveRun(ref, run.routineId, outcome.reply);
        else await markInterrupted(ref);
        resolved += 1;
      } catch (error) {
        logger.warn({ error, runId: run.id }, "Boot sweep failed to resolve an awaiting run");
      }
    }
    return resolved;
  }

  return { resolveConversation, bootSweep };
}
