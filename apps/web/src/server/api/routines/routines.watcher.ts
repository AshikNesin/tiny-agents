/**
 * The completion listener: fired runs await their bot's reply in the
 * routine's own conversation (issue #63), and this watcher resolves them off
 * the runtime's activity feed. When a conversation holding an awaiting run
 * goes idle, the run adopts the last assistant reply (2000-char preview) or
 * the model error. A run that could not do its job ends `blocked` (issue
 * #87), with the reason: one whose tool call was refused (nobody watches a
 * routine's conversation to approve it or fill in a sign-in), or one that
 * said so itself (`report_routine_blocked`). Three blocked runs in a row
 * pause the routine (routines.service.ts). A boot sweep marks runs whose
 * conversations are idle at startup as failed (interrupted by restart).
 * Each resolved run shows as a card in the chat.
 */
import { prisma } from "@groot/core/database";
import { logger } from "@groot/core/logger";
import type { AgentRuntime, FinishedReply } from "@tiny-agents/agent";
import type { RoutineRunRef } from "../notifications/notifications.events";
import { announceRun } from "./routines.cards";
import { clearBlockedStreak, recordBlockedRun } from "./routines.service";

export const OUTPUT_PREVIEW_CHARS = 2000;
const ERROR_PREVIEW_CHARS = 500;

/** Minimal runtime surface the watcher needs (the full AgentRuntime satisfies it). */
export type RoutinesRuntime = Pick<
  AgentRuntime,
  "onActivity" | "isBusy" | "finishedReplies" | "listCapabilities"
>;

export interface RoutinesCompletionWatcher {
  /** Resolve awaiting runs of one conversation (used on idle transitions). */
  resolveConversation(conversationId: number): Promise<number>;
  /** Boot sweep: awaiting runs on already-idle conversations are interrupted. */
  bootSweep(): Promise<number>;
}

function preview(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * The reply that answers a run: the newest assistant message created after
 * the floor (the run's submit, or the previous run's answer) and before the
 * next run's submit. A stale reply (one that predates the submit) never
 * answers, and one reply never answers two runs, mirroring bots.relay.ts's
 * correlation rule. Several assistant messages inside one turn (tool calls)
 * all belong to the same run, hence the newest in the window.
 */
export function matchingReply(
  replies: FinishedReply[],
  floorMs: number,
  untilMs?: number,
): FinishedReply | undefined {
  let match: FinishedReply | undefined;
  for (const reply of replies) {
    if (reply.createdAt <= floorMs) continue;
    if (untilMs !== undefined && reply.createdAt > untilMs) break;
    match = reply;
  }
  return match;
}

/**
 * Tools refused for want of an approval among the replies after the floor
 * and up to `untilMs`: every message of the run's turn, not only the last.
 */
export function refusedTools(
  replies: FinishedReply[],
  floorMs: number,
  untilMs?: number,
): string[] {
  const names = new Set<string>();
  for (const reply of replies) {
    if (reply.createdAt <= floorMs) continue;
    if (untilMs !== undefined && reply.createdAt > untilMs) break;
    for (const name of reply.refused ?? []) names.add(name);
  }
  return [...names];
}

/**
 * The reason the run gave for being blocked (`report_routine_blocked`): the
 * newest one in the run's window, like `refusedTools`.
 */
export function blockedReason(
  replies: FinishedReply[],
  floorMs: number,
  untilMs?: number,
): string | undefined {
  let reason: string | undefined;
  for (const reply of replies) {
    if (reply.createdAt <= floorMs) continue;
    if (untilMs !== undefined && reply.createdAt > untilMs) break;
    if (reply.blocked !== undefined) reason = reply.blocked;
  }
  return reason;
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

async function awaitingRunsWithBot() {
  const rows = await prisma.routineRun.findMany({
    where: { status: "awaiting" },
    orderBy: { scheduledFor: "asc" },
    include: {
      routine: {
        select: {
          name: true,
          conversationId: true,
          bot: { select: { id: true, name: true, conversationId: true } },
        },
      },
    },
  });
  return rows.map((row) => ({
    run: row,
    // Runs fired before routines had conversations of their own awaited the chat.
    conversationId: Number(row.routine.conversationId ?? row.routine.bot.conversationId),
    ref: {
      runId: row.id,
      routineName: row.routine.name,
      bot: { id: row.routine.bot.id, name: row.routine.bot.name },
    } satisfies RoutineRunRef,
  }));
}

export function createRoutinesCompletionWatcher(rt: RoutinesRuntime): RoutinesCompletionWatcher {
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

  async function resolveRun(
    ref: RoutineRunRef,
    routineId: string,
    reply: FinishedReply,
    refused: string[],
    blocked: string | undefined,
  ): Promise<void> {
    if (reply.error !== undefined) {
      const error = preview(reply.error, ERROR_PREVIEW_CHARS);
      await prisma.routineRun.update({
        where: { id: ref.runId },
        data: { status: "failed", finishedAt: new Date(), error },
      });
      await clearBlockedStreak(routineId);
      announceRun(ref, { status: "failed", error });
      return;
    }
    const output = preview(reply.text, OUTPUT_PREVIEW_CHARS);
    const reasons = [
      blocked,
      refused.length > 0 ? refusalReason(refused, askOnlyTools()) : undefined,
    ].filter((reason): reason is string => reason !== undefined);
    if (reasons.length > 0) {
      const error = preview(reasons.join(" "), ERROR_PREVIEW_CHARS);
      await prisma.routineRun.update({
        where: { id: ref.runId },
        data: { status: "blocked", finishedAt: new Date(), error, output: output || null },
      });
      const pausedReason = await recordBlockedRun(routineId, error);
      announceRun(ref, { status: "blocked", error, pausedReason });
      return;
    }
    await prisma.routineRun.update({
      where: { id: ref.runId },
      data: { status: "succeeded", finishedAt: new Date(), output },
    });
    await clearBlockedStreak(routineId);
    announceRun(ref, { status: "succeeded", output });
  }

  async function markInterrupted(ref: RoutineRunRef): Promise<void> {
    await prisma.routineRun.update({
      where: { id: ref.runId },
      data: { status: "failed", finishedAt: new Date(), error: "interrupted" },
    });
    announceRun(ref, { status: "failed", error: "Interrupted by a server restart." });
  }

  async function resolveConversation(conversationId: number): Promise<number> {
    let resolved = 0;
    const runs = (await awaitingRunsWithBot()).filter(
      (row) => row.conversationId === conversationId,
    );
    if (runs.length === 0) return 0;
    const replies = await rt.finishedReplies(conversationId);
    // One reply answers one run, oldest first: each match raises the floor so
    // a second queued run on the same bot waits for its own later reply, and
    // stops before the next run's submit so it cannot steal that answer (the
    // same correlation rule as bots.relay.ts matchReplies).
    let floor = 0;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i].run;
      const next = runs[i + 1]?.run.submittedAt?.getTime();
      const floorAt = Math.max(floor, run.submittedAt?.getTime() ?? 0);
      const reply =
        next !== undefined
          ? matchingReply(replies, floorAt, next)
          : matchingReply(replies, floorAt);
      if (!reply) continue;
      const refused = refusedTools(replies, floorAt, reply.createdAt);
      const blocked = blockedReason(replies, floorAt, reply.createdAt);
      floor = reply.createdAt;
      try {
        await resolveRun(runs[i].ref, run.routineId, reply, refused, blocked);
        resolved += 1;
      } catch (error) {
        logger.warn({ error, runId: run.id }, "Failed to resolve an awaiting routine run");
      }
    }
    return resolved;
  }

  async function bootSweep(): Promise<number> {
    let resolved = 0;
    const rows = await awaitingRunsWithBot();
    for (const { run, conversationId, ref } of rows) {
      // Idle at boot means the interrupted reply never arrives: the server
      // restarted between submit and completion. A busy conversation may
      // still be finishing its turn; the idle listener resolves it later.
      if (rt.isBusy(conversationId)) continue;
      try {
        await markInterrupted(ref);
        resolved += 1;
      } catch (error) {
        logger.warn({ error, runId: run.id }, "Boot sweep failed to resolve an awaiting run");
      }
    }
    return resolved;
  }

  return { resolveConversation, bootSweep };
}

/**
 * Wire the watcher onto the runtime's activity feed and run the boot sweep.
 * Mirrors how index.ts wires bots.relay.ts.
 */
export function startRoutinesWatcher(rt: RoutinesRuntime): RoutinesCompletionWatcher {
  const watcher = createRoutinesCompletionWatcher(rt);
  rt.onActivity(async (change) => {
    if (change.busy) return;
    try {
      await watcher.resolveConversation(Number(change.conversation));
    } catch {
      // Idle resolutions are best-effort; the next idle retries.
    }
  });
  void watcher.bootSweep().catch(() => undefined);
  return watcher;
}
