import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { registerJobHandler } from "@groot/jobs/server/worker";
import { scheduleJob } from "@groot/jobs/server/queue";
import {
  codeProjects,
  codePullRequests,
  codeReviews,
  codeThreads,
  db,
  type CodeProjectRow,
  type CodeReviewRow,
} from "../../db";
import { codeGitHub } from "./code.github";
import { codeHub } from "./code.hub";
import { reviewPath } from "./code.reviews";
import type { Workspace } from "./code.workspace";

const PRUNE_JOB = "code-review-prune";
const PRUNE_CRON = "15 4 * * *";
const IDLE_MS = 24 * 60 * 60 * 1000;

async function viewerLogin(project: CodeProjectRow): Promise<string | null> {
  try {
    const github = await codeGitHub().client(project);
    return (await github.viewer()).login.toLowerCase();
  } catch (error) {
    logger.warn({ error, projectId: project.id }, "Code: could not read who owns these reviews");
    return null;
  }
}

async function assistantBusy(row: CodeReviewRow, cutoff: Date): Promise<boolean> {
  if (!row.threadId) return false;
  const thread = await db.query.codeThreads.findFirst({ where: eq(codeThreads.id, row.threadId) });
  if (thread && thread.updatedAt >= cutoff) return true;
  const target = codeHub()?.resolve(row.threadId);
  if (!target) return false;
  const outcome = await target.instance.outcome(target.nativeId);
  return outcome.working;
}

async function reasonToKeep(
  row: CodeReviewRow,
  project: CodeProjectRow,
  login: string,
  ws: Workspace,
  cutoff: Date,
): Promise<string | null> {
  if (row.author.toLowerCase() === login) return "the owner's PR";
  if (row.reviewingSince) return "the agent is reviewing it";
  const coding = await db.query.codePullRequests.findFirst({
    where: and(eq(codePullRequests.projectId, project.id), eq(codePullRequests.number, row.number)),
  });
  if (coding) return "a Code thread opened it";
  if (await assistantBusy(row, cutoff)) return "its assistant was used in the last day";
  const path = row.worktree!;
  if (!(await ws.exists(path))) return null;
  if ((await ws.uncommitted(path)).length > 0) return "it has uncommitted changes";
  if ((await ws.headSha(path)) !== row.headSha) return "it has local commits";
  return null;
}

async function pruneOne(
  row: CodeReviewRow,
  project: CodeProjectRow,
  login: string,
  ws: Workspace,
  cutoff: Date,
): Promise<boolean> {
  const keep = await reasonToKeep(row, project, login, ws, cutoff);
  if (keep) {
    logger.debug({ reviewId: row.id, keep }, "Code: kept a review checkout");
    return false;
  }
  if (await ws.exists(row.worktree!)) await ws.removeWorktree(project.checkoutPath, row.worktree!);
  await db
    .update(codeReviews)
    .set({ worktree: null })
    .where(and(eq(codeReviews.id, row.id), eq(codeReviews.worktree, row.worktree!)));
  return true;
}

export async function pruneReviewCheckouts(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IDLE_MS);
  const rows = await db
    .select({ review: codeReviews, project: codeProjects })
    .from(codeReviews)
    .innerJoin(codeProjects, eq(codeProjects.id, codeReviews.projectId))
    .where(
      and(
        isNull(codeReviews.archivedAt),
        isNotNull(codeReviews.worktree),
        eq(codeReviews.mine, false),
        lt(codeReviews.updatedAt, cutoff),
      ),
    );
  const owners = new Map<string, Promise<string | null>>();
  let pruned = 0;
  for (const { review, project } of rows) {
    if (review.worktree !== reviewPath(project, review.number)) continue;
    if (!owners.has(project.id)) owners.set(project.id, viewerLogin(project));
    const login = await owners.get(project.id)!;
    if (!login) continue;
    try {
      const ws = await codeGitHub().workspace(project);
      if (await pruneOne(review, project, login, ws, cutoff)) pruned += 1;
    } catch (error) {
      logger.warn({ error, reviewId: review.id }, "Code: could not prune a review checkout");
    }
  }
  if (pruned) logger.info(`Code: pruned ${pruned} idle PR review checkout(s)`);
  return pruned;
}

export function registerReviewPruneJob(): void {
  registerJobHandler(PRUNE_JOB, async () => {
    await pruneReviewCheckouts();
  });
}

export function scheduleReviewPrune(): Promise<unknown> {
  return scheduleJob(PRUNE_JOB, null, PRUNE_CRON, { timezone: "Asia/Kolkata" });
}
