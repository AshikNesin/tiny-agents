import { desc, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { codeCheckpoints, db, type CodeCheckpoint } from "../../db";
import { codeGitHub } from "./code.github";
import { codeHub } from "./code.hub";
import { projectThread, threadWorktree } from "./code.projects";
import { checkpointRef, type Workspace } from "./code.workspace";

type CheckpointReason = "start" | "turn" | "before_revert";

export async function checkpointsOf(threadId: string): Promise<CodeCheckpoint[]> {
  return db
    .select()
    .from(codeCheckpoints)
    .where(eq(codeCheckpoints.threadId, threadId))
    .orderBy(desc(codeCheckpoints.seq));
}

export async function takeCheckpoint(
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

export async function checkpointTurn(threadId: string): Promise<CodeCheckpoint | undefined> {
  const found = await projectThread(threadId);
  if (!found?.thread.worktree || !found.thread.branch) return undefined;
  const ws = await codeGitHub().workspace(found.project);
  return takeCheckpoint(
    ws,
    { id: threadId, branch: found.thread.branch, worktree: found.thread.worktree },
    "turn",
  );
}

export async function checkpointRange(threadId: string, checkpointId: string) {
  const [{ worktree, ws }, all] = await Promise.all([
    threadWorktree(threadId),
    checkpointsOf(threadId),
  ]);
  const index = all.findIndex((c) => c.id === checkpointId);
  if (index < 0) throw Boom.notFound("No such checkpoint");
  const to = all[index]!;
  return { from: all[index + 1] ?? to, to, worktree, ws };
}

export async function revertTo(
  threadId: string,
  checkpointId: string,
): Promise<CodeCheckpoint | undefined> {
  const { worktree, branch, ws } = await threadWorktree(threadId);
  const checkpoint = (await checkpointsOf(threadId)).find((c) => c.id === checkpointId);
  if (!checkpoint) throw Boom.notFound("No such checkpoint");
  const thread = { id: threadId, branch, worktree };
  const working = async () => {
    const target = codeHub()?.resolve(threadId);
    const outcome = await target?.instance.outcome(target.nativeId).catch(() => undefined);
    return outcome?.working === true;
  };
  const work = async (): Promise<CodeCheckpoint | undefined> => {
    if (await working()) throw Boom.conflict("Stop the agent before reverting its files.");
    const before = await takeCheckpoint(ws, thread, "before_revert");
    if (await working()) throw Boom.conflict("Stop the agent before reverting its files.");
    await ws.restore(thread.worktree, checkpoint.sha);
    return before;
  };
  const hub = codeHub();
  return hub ? hub.serial(`send:${threadId}`, work) : work();
}
