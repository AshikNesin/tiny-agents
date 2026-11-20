/**
 * Per-turn checkpoints of a project thread (issue #297 phase 6): the
 * worktree at the thread's start and at every turn end, uncommitted and new
 * files included, kept as commits under hidden refs
 * (`refs/tiny-agents/checkpoints/<branch>/<seq>`) in the project's clone.
 * They give Changes a per-turn diff, and **Revert to here** puts the files
 * back as they were, as uncommitted changes on top of the branch: history,
 * and anything already pushed, is never rewritten. A revert first takes a
 * checkpoint of the state it replaces, so it can itself be undone.
 */
import { desc, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { codeCheckpoints, db, type CodeCheckpoint } from "../../db";
import { codeGitHub } from "./code.github";
import { codeHub } from "./code.hub";
import { projectThread } from "./code.projects";
import { checkpointRef, type Workspace } from "./code.workspace";

type CheckpointReason = "start" | "turn" | "before_revert";

export async function checkpointsOf(threadId: string): Promise<CodeCheckpoint[]> {
  return db
    .select()
    .from(codeCheckpoints)
    .where(eq(codeCheckpoints.threadId, threadId))
    .orderBy(desc(codeCheckpoints.seq));
}

/**
 * Take a checkpoint of a worktree, unless nothing changed since the last
 * one. Answers the row, or undefined when it was skipped.
 */
async function takeCheckpoint(
  ws: Workspace,
  thread: { id: string; branch: string; worktree: string },
  reason: CheckpointReason,
): Promise<CodeCheckpoint | undefined> {
  const [last] = await checkpointsOf(thread.id);
  const seq = (last?.seq ?? -1) + 1;
  const sha = await ws.checkpoint(thread.worktree, checkpointRef(thread.branch, seq));
  const headSha = await ws.headSha(thread.worktree);
  if (
    last &&
    reason === "turn" &&
    (await ws.changedPaths(thread.worktree, last.sha, sha)).length === 0
  ) {
    return undefined;
  }
  const [row] = await db
    .insert(codeCheckpoints)
    .values({ threadId: thread.id, seq, sha, headSha, reason })
    .onConflictDoNothing()
    .returning();
  return row;
}

/** A project thread's turn ended: checkpoint its worktree. */
export async function checkpointTurn(threadId: string): Promise<CodeCheckpoint | undefined> {
  const found = await projectThread(threadId);
  if (!found?.thread.worktree || !found.thread.branch) return undefined;
  const ws = await codeGitHub().workspace(found.project);
  return takeCheckpoint(
    ws,
    {
      id: threadId,
      branch: found.thread.branch,
      worktree: found.thread.worktree,
    },
    "turn",
  );
}

/** A checkpoint and the one before it (what that turn changed). */
export async function checkpointRange(
  threadId: string,
  checkpointId: string,
): Promise<{
  from: CodeCheckpoint;
  to: CodeCheckpoint;
  worktree: string;
  ws: Workspace;
}> {
  const found = await projectThread(threadId);
  if (!found?.thread.worktree) throw Boom.notFound("The thread has no worktree.");
  const all = await checkpointsOf(threadId);
  const index = all.findIndex((c) => c.id === checkpointId);
  if (index < 0) throw Boom.notFound("No such checkpoint");
  const to = all[index]!;
  const from = all[index + 1] ?? to;
  return {
    from,
    to,
    worktree: found.thread.worktree,
    ws: await codeGitHub().workspace(found.project),
  };
}

/** Put the worktree back as it was at a checkpoint (never while the agent works). */
export async function revertTo(
  threadId: string,
  checkpointId: string,
): Promise<CodeCheckpoint | undefined> {
  const found = await projectThread(threadId);
  if (!found?.thread.worktree || !found.thread.branch) {
    throw Boom.notFound("The thread has no worktree.");
  }
  const target = codeHub()?.resolve(threadId);
  const outcome = await target?.instance.outcome(target.nativeId).catch(() => undefined);
  if (outcome?.working) throw Boom.conflict("Stop the agent before reverting its files.");
  const checkpoint = (await checkpointsOf(threadId)).find((c) => c.id === checkpointId);
  if (!checkpoint) throw Boom.notFound("No such checkpoint");
  const ws = await codeGitHub().workspace(found.project);
  const thread = {
    id: threadId,
    branch: found.thread.branch,
    worktree: found.thread.worktree,
  };
  const before = await takeCheckpoint(ws, thread, "before_revert");
  await ws.restore(thread.worktree, checkpoint.sha);
  return before;
}
