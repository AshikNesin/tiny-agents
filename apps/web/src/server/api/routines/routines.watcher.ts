/**
 * The completion listener: fired runs await their bot's reply, and this
 * watcher resolves them off the runtime's activity feed. When a conversation
 * holding an awaiting run goes idle, the run adopts the last assistant reply
 * (2000-char preview) or the model error. A boot sweep marks runs whose
 * conversations are idle at startup as failed (interrupted by restart).
 */
import { prisma } from "@groot/core/database";
import { logger } from "@groot/core/logger";
import type { AgentRuntime, ChatState } from "@tiny-agents/agent";

export const OUTPUT_PREVIEW_CHARS = 2000;
const ERROR_PREVIEW_CHARS = 500;

/** Minimal runtime surface the watcher needs (the full AgentRuntime satisfies it). */
export type RoutinesRuntime = Pick<AgentRuntime, "onActivity" | "isBusy" | "watchChat">;

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
  replies: { text: string; createdAt: number }[],
  floorMs: number,
  untilMs?: number,
): { text: string; createdAt: number } | undefined {
  let match: { text: string; createdAt: number } | undefined;
  for (const reply of replies) {
    if (reply.createdAt <= floorMs) continue;
    if (untilMs !== undefined && reply.createdAt > untilMs) break;
    match = reply;
  }
  return match;
}

async function awaitingRunsWithBot() {
  const rows = await prisma.routineRun.findMany({
    where: { status: "awaiting" },
    orderBy: { scheduledFor: "asc" },
    include: { routine: { select: { bot: { select: { conversationId: true } } } } },
  });
  return rows.map((row) => ({
    run: row,
    conversationId: Number(row.routine.bot.conversationId),
  }));
}

export function createRoutinesCompletionWatcher(rt: RoutinesRuntime): RoutinesCompletionWatcher {
  async function assistantReplies(conversationId: number) {
    const replies: { text: string; createdAt: number }[] = [];
    const sub = await rt.watchChat(conversationId, (events) => {
      for (const event of events) {
        if (event.type !== "snapshot") continue;
        for (const message of (event.state as ChatState).messages) {
          if (message.role !== "assistant" || !message.text) continue;
          replies.push({ text: message.text, createdAt: message.createdAt });
        }
      }
    });
    await sub.stop();
    return replies;
  }

  async function resolveRun(
    runId: string,
    reply: { text: string; createdAt: number },
  ): Promise<void> {
    const failed = reply.text.trimStart().startsWith("⚠");
    if (failed) {
      await prisma.routineRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          error: preview(reply.text, ERROR_PREVIEW_CHARS),
        },
      });
      return;
    }
    await prisma.routineRun.update({
      where: { id: runId },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        output: preview(reply.text, OUTPUT_PREVIEW_CHARS),
      },
    });
  }

  async function markInterrupted(runId: string): Promise<void> {
    await prisma.routineRun.update({
      where: { id: runId },
      data: { status: "failed", finishedAt: new Date(), error: "interrupted" },
    });
  }

  async function resolveConversation(conversationId: number): Promise<number> {
    let resolved = 0;
    const runs = (await awaitingRunsWithBot()).filter(
      (row) => row.conversationId === conversationId,
    );
    if (runs.length === 0) return 0;
    const replies = await assistantReplies(conversationId);
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
      floor = reply.createdAt;
      try {
        await resolveRun(run.id, reply);
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
    for (const { run, conversationId } of rows) {
      // Idle at boot means the interrupted reply never arrives: the server
      // restarted between submit and completion. A busy conversation may
      // still be finishing its turn; the idle listener resolves it later.
      if (rt.isBusy(conversationId)) continue;
      try {
        await markInterrupted(run.id);
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
