import { and, desc, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { createId } from "@groot/core/utils/id.utils";
import { codeCheckpoints, codeThreads, db } from "../../db";
import { takeCheckpoint } from "./code.checkpoints";
import type { CodeHub } from "./code.hub";
import { threadWorktree } from "./code.projects";
import { runsOf, startRun } from "./code.runs";

export interface RewindInput {
  at: string;
  turn: number;
  turns: number;
  text: string;
}

export interface RewindResult {
  filesRestored: boolean;
  replaced: string;
}

async function checkpointBefore(threadId: string, input: RewindInput) {
  const runs = await runsOf(threadId);
  if (runs.length !== input.turns) return undefined;
  const seq = runs[input.turn]?.checkpointSeq;
  if (seq === null || seq === undefined) return undefined;
  const [checkpoint] = await db
    .select()
    .from(codeCheckpoints)
    .where(and(eq(codeCheckpoints.threadId, threadId), eq(codeCheckpoints.seq, seq)));
  return checkpoint;
}

export async function rewindThread(
  hub: CodeHub,
  threadId: string,
  input: RewindInput,
): Promise<RewindResult> {
  const target = hub.resolve(threadId);
  if (!target) throw Boom.notFound("No agent serves this thread");
  const { instance, nativeId } = target;
  const forkBefore = instance.forkBefore?.bind(instance);
  if (!instance.capabilities().threads.rewind || !forkBefore) {
    throw Boom.badRequest(`${instance.label} cannot go back to an earlier turn.`);
  }
  if ((await instance.outcome(nativeId)).working) {
    throw Boom.conflict("Stop the agent before editing an earlier turn.");
  }
  const { thread, worktree, branch, ws } = await threadWorktree(threadId);
  const checkpoint = await checkpointBefore(threadId, input);
  if (checkpoint) {
    await takeCheckpoint(ws, { id: threadId, branch, worktree }, "before_revert");
    await ws.restore(worktree, checkpoint.sha);
  }
  const forked = await forkBefore(nativeId, input.at);
  const replaced = createId();
  db.transaction((tx) => {
    tx.update(codeThreads)
      .set({ nativeId: `${nativeId}.replaced.${replaced}` })
      .where(eq(codeThreads.id, threadId))
      .run();
    tx.insert(codeThreads)
      .values({
        id: replaced,
        instanceId: instance.id,
        nativeId,
        projectId: thread.projectId,
        title: `${thread.title} (before the edit)`,
        archived: true,
        followed: true,
        data: JSON.stringify({ replacedBy: threadId }),
      })
      .run();
    tx.update(codeThreads)
      .set({ nativeId: forked.nativeId, attention: null, updatedAt: new Date() })
      .where(eq(codeThreads.id, threadId))
      .run();
  });
  await instance.send(forked.nativeId, { message: input.text });
  await startRun(threadId, { trigger: "owner" });
  await hub.refresh(instance.id);
  return { filesRestored: Boolean(checkpoint), replaced };
}

export async function undoRewind(hub: CodeHub, threadId: string, replaced: string): Promise<void> {
  const [kept] = await db.select().from(codeThreads).where(eq(codeThreads.id, replaced));
  const target = hub.resolve(threadId);
  if (!kept || !target || !kept.data.includes(JSON.stringify(threadId))) {
    throw Boom.notFound("That edit can no longer be undone.");
  }
  const { instance, nativeId } = target;
  await instance.interrupt(nativeId);
  const { worktree, ws } = await threadWorktree(threadId);
  const [before] = await db
    .select()
    .from(codeCheckpoints)
    .where(and(eq(codeCheckpoints.threadId, threadId), eq(codeCheckpoints.reason, "before_revert")))
    .orderBy(desc(codeCheckpoints.seq))
    .limit(1);
  if (before) await ws.restore(worktree, before.sha);
  db.transaction((tx) => {
    tx.delete(codeThreads).where(eq(codeThreads.id, replaced)).run();
    tx.update(codeThreads)
      .set({ nativeId: kept.nativeId, updatedAt: new Date() })
      .where(eq(codeThreads.id, threadId))
      .run();
  });
  await hub.refresh(instance.id);
}
