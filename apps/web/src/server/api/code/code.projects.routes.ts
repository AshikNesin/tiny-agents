/**
 * Code projects, GitHub, pull requests and review (issue #297), under
 * `/api/v1/code`. Owner-only: none of these paths is in `GUEST_ACCESS`, so
 * the guest guard refuses them before they get here.
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "@groot/core/types";
import { env } from "@groot/core/env";
import { Boom } from "@groot/core/errors";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody } from "@groot/core/utils/controller.utils";
import type { CodeCheckpoint } from "../../db";
import type {
  CheckLogView,
  CheckpointView,
  GitHubStatus,
  ProjectView,
  InboxPullView,
  PullReviewView,
  PullThreadsView,
  PushedReview,
  ReviewTerminal,
  SuggestedChanges,
  ReviewDraft,
  ReviewFile,
  ThreadPullsView,
} from "../../../shared/api/code";
import {
  codeGitHub,
  disconnectGitHubApp,
  githubStatus,
  setGitHubToken,
  startInstall,
  startManifest,
} from "./code.github";
import { setFlowCookie } from "./code.webhook";
import { threadReview } from "./code.review";
import { checkpointRange, checkpointsOf, revertTo } from "./code.checkpoints";
import { codeHub } from "./code.hub";
import { checkLog } from "./code.checks";
import { WorkspaceError, cleanBranchPrefix } from "./code.workspace";
import {
  archiveReview,
  askReview,
  discardReviewChanges,
  getReview,
  listReviews,
  openReview,
  pushReview,
  reviewComments,
  replyToReviewThread,
  reviewInbox,
  resolveReviewThread,
  reviewTerminal,
  reviewIdOfKey,
  reviewThreads,
  reviewWorktree,
  sendCommentsToThread,
  submitReview,
  suggestReviewChanges,
} from "./code.reviews";
import {
  createProject,
  deleteProject,
  listProjects,
  projectThread,
  projectView,
  updateProject,
} from "./code.projects";
import {
  editPull,
  linkPull,
  manualPass,
  mergePull,
  readyPull,
  publish,
  setAutoMerge,
  setAutofix,
  setSpendLimit,
  threadPulls,
  unlinkPull,
} from "./code.pulls";

const router = new Hono<AppEnv>();

/** A repository-relative path from the query: no `..`, not absolute. */
/** The largest file the review's light editor saves (characters). */
const MAX_EDIT_BYTES = 1_000_000;

function safePath(raw: string | undefined): string {
  const path = raw ?? "";
  if (
    !path ||
    path.length > 1024 ||
    path.startsWith("/") ||
    path.split("/").some((s) => s === "..")
  ) {
    throw Boom.badRequest("Invalid path");
  }
  return path;
}

const threadParam = (raw: string | undefined) => {
  const id = decodeURIComponent(raw ?? "");
  if (!id || id.length > 300) throw Boom.badRequest("Invalid thread");
  return id;
};

// --- GitHub settings ---------------------------------------------------------------------

router.get("/code/github", async (c) => ok<GitHubStatus>(c, await githubStatus()));

router.put("/code/github", async (c) => {
  const { token } = await parseBody(
    c,
    z.object({ token: z.string().trim().min(10).max(400).nullable() }),
  );
  await setGitHubToken(token);
  return ok<GitHubStatus>(c, await githubStatus());
});

/**
 * Create the GitHub App in one click (GitHub's App Manifest flow, as
 * FeedbackBee does): answers the manifest the page posts to GitHub, and
 * binds the flow to this browser with a short-lived httpOnly cookie.
 */
router.post("/code/github/app/manifest", async (c) => {
  const { organization } = await parseBody(
    c,
    z.object({
      organization: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/)
        .optional(),
    }),
  );
  const flow = await startManifest(env.ORIGIN, organization);
  setFlowCookie(c, flow.binding);
  return ok(c, { url: flow.url, manifest: flow.manifest, webhooks: flow.webhooks });
});

/** Install the App on repositories, or change which: GitHub's page, then back to `installed`. */
router.post("/code/github/app/install", async (c) => {
  const flow = await startInstall();
  setFlowCookie(c, flow.binding);
  return ok(c, { url: flow.url });
});

router.get("/code/github/app/repositories", async (c) =>
  ok(c, await codeGitHub().appRepositories()),
);

router.delete("/code/github/app", async (c) => {
  await disconnectGitHubApp();
  return ok<GitHubStatus>(c, await githubStatus());
});

// --- projects ------------------------------------------------------------------------------

router.get("/code/projects", async (c) =>
  ok<ProjectView[]>(c, (await listProjects()).map(projectView)),
);

const createSchema = z.object({
  repo: z.string().trim().min(3).max(300),
  transport: z.enum(["gh", "app"]).optional(),
  name: z.string().trim().max(100).optional(),
  baseBranch: z.string().trim().max(200).optional(),
  defaultInstanceId: z.string().trim().max(40).optional(),
  defaultModel: z.string().trim().max(200).optional(),
});

router.post("/code/projects", async (c) => {
  const body = await parseBody(c, createSchema);
  return ok<ProjectView>(c, projectView(await createProject(body)), 201);
});

const scriptsSchema = z.strictObject({
  setup: z.string().max(4000).optional(),
  check: z.string().max(4000).optional(),
  archive: z.string().max(4000).optional(),
});

const updateSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  baseBranch: z.string().trim().min(1).max(200).optional(),
  defaultInstanceId: z.string().trim().max(40).nullable().optional(),
  defaultModel: z.string().trim().max(200).nullable().optional(),
  settings: z
    .strictObject({
      scripts: scriptsSchema.optional(),
      archiveOnMerge: z.boolean().optional(),
      branchPrefix: z
        .string()
        .max(40)
        .transform((text, ctx) => {
          const prefix = cleanBranchPrefix(text);
          if (prefix !== null) return prefix;
          ctx.addIssue({ code: "custom", message: "Git can't start a branch name with that." });
          return z.NEVER;
        })
        .optional(),
      protectedPaths: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
      autofix: z
        .strictObject({
          triggers: z
            .strictObject({
              checks: z.boolean().optional(),
              reviews: z.boolean().optional(),
              conflicts: z.boolean().optional(),
              mergeQueue: z.boolean().optional(),
            })
            .optional(),
          trustedBots: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
          hourlyLimit: z.number().int().min(1).max(30).optional(),
          noOwnerLimit: z.number().int().min(1).max(50).optional(),
          passMinutes: z.number().int().min(5).max(120).optional(),
          onByDefault: z.boolean().optional(),
          finalCheck: z.boolean().optional(),
          autoMergeByDefault: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

router.patch("/code/projects/:project", async (c) => {
  const change = await parseBody(c, updateSchema);
  return ok<ProjectView>(c, projectView(await updateProject(c.req.param("project"), change)));
});

router.delete("/code/projects/:project", async (c) => {
  await deleteProject(c.req.param("project"));
  return ok(c, { deleted: true });
});

// --- one thread's pull requests ------------------------------------------------------------

router.get("/code/threads/:id/pr", async (c) => {
  const fresh = c.req.query("fresh") !== "false";
  return ok<ThreadPullsView>(c, await threadPulls(threadParam(c.req.param("id")), fresh));
});

router.get("/code/threads/:id/pr/checks/:job/log", async (c) => {
  const job = Number(c.req.param("job"));
  if (!Number.isSafeInteger(job) || job < 1) throw Boom.badRequest("Not a job id.");
  return ok<CheckLogView>(c, await checkLog(threadParam(c.req.param("id")), job));
});

router.post("/code/threads/:id/publish", async (c) => {
  const id = threadParam(c.req.param("id"));
  const body = await parseBody(
    c,
    z.object({
      title: z.string().trim().max(250).optional(),
      body: z.string().max(60_000).optional(),
    }),
  );
  await publish(id, body);
  return ok<ThreadPullsView>(c, await threadPulls(id, false), 201);
});

router.post("/code/threads/:id/pr/link", async (c) => {
  const id = threadParam(c.req.param("id"));
  const { number } = await parseBody(c, z.object({ number: z.number().int().min(1) }));
  await linkPull(id, number);
  return ok<ThreadPullsView>(c, await threadPulls(id), 201);
});

router.post("/code/threads/:id/pr/unlink", async (c) => {
  const id = threadParam(c.req.param("id"));
  await unlinkPull(id);
  return ok<ThreadPullsView>(c, await threadPulls(id, false));
});

router.post("/code/threads/:id/pr/autofix", async (c) => {
  const id = threadParam(c.req.param("id"));
  const { enabled } = await parseBody(c, z.object({ enabled: z.boolean() }));
  await setAutofix(id, enabled);
  return ok<ThreadPullsView>(c, await threadPulls(id, false));
});

router.post("/code/threads/:id/pr/fix", async (c) => {
  const id = threadParam(c.req.param("id"));
  const result = await manualPass(id);
  return ok(c, { ...result, view: await threadPulls(id, false) });
});

router.post("/code/threads/:id/pr/automerge", async (c) => {
  const id = threadParam(c.req.param("id"));
  const { enabled } = await parseBody(c, z.object({ enabled: z.boolean() }));
  await setAutoMerge(id, enabled);
  return ok<ThreadPullsView>(c, await threadPulls(id, false));
});

router.post("/code/threads/:id/spend-limit", async (c) => {
  const id = threadParam(c.req.param("id"));
  const { limitUsd } = await parseBody(
    c,
    z.object({ limitUsd: z.number().min(0.01).max(10_000).nullable() }),
  );
  await setSpendLimit(id, limitUsd);
  return ok<ThreadPullsView>(c, await threadPulls(id, false));
});

// --- per-turn checkpoints ---------------------------------------------------------------

const checkpointView = (row: CodeCheckpoint): CheckpointView => ({
  id: row.id,
  seq: row.seq,
  reason: row.reason as CheckpointView["reason"],
  headSha: row.headSha,
  createdAt: row.createdAt.toISOString(),
});

router.get("/code/threads/:id/checkpoints", async (c) => {
  const id = threadParam(c.req.param("id"));
  return ok<CheckpointView[]>(c, (await checkpointsOf(id)).map(checkpointView));
});

/** What one turn changed: its checkpoint against the one before it. */
router.get("/code/threads/:id/checkpoints/:cp/files", async (c) => {
  const id = threadParam(c.req.param("id"));
  const { from, to, worktree, ws } = await checkpointRange(id, c.req.param("cp"));
  const files = from.id === to.id ? [] : await ws.rangeFiles(worktree, from.sha, to.sha);
  return ok<ReviewFile[]>(
    c,
    files.map((f) => ({ ...f, viewed: false })),
  );
});

router.get("/code/threads/:id/checkpoints/:cp/file", async (c) => {
  const id = threadParam(c.req.param("id"));
  const path = safePath(c.req.query("path"));
  const { from, to, worktree, ws } = await checkpointRange(id, c.req.param("cp"));
  return ok(c, { path, ...(await ws.rangeFile(worktree, from.sha, to.sha, path)) });
});

router.post("/code/threads/:id/checkpoints/:cp/revert", async (c) => {
  const id = threadParam(c.req.param("id"));
  const before = await revertTo(id, c.req.param("cp"));
  return ok(c, { reverted: true, undo: before ? checkpointView(before) : null });
});

router.patch("/code/threads/:id/pr", async (c) => {
  const id = threadParam(c.req.param("id"));
  const change = await parseBody(
    c,
    z
      .object({
        title: z.string().trim().min(1).max(256).optional(),
        body: z.string().max(65_536).optional(),
      })
      .refine((v) => v.title !== undefined || v.body !== undefined, "Nothing to change."),
  );
  await editPull(id, change);
  return ok<ThreadPullsView>(c, await threadPulls(id, false));
});

router.post("/code/threads/:id/pr/merge", async (c) => {
  const id = threadParam(c.req.param("id"));
  const { method } = await parseBody(
    c,
    z.object({ method: z.enum(["merge", "squash", "rebase"]) }),
  );
  await mergePull(id, method);
  return ok<ThreadPullsView>(c, await threadPulls(id, false));
});

router.post("/code/threads/:id/pr/ready", async (c) => {
  const id = threadParam(c.req.param("id"));
  await readyPull(id);
  return ok<ThreadPullsView>(c, await threadPulls(id, false));
});

// --- review: base-branch diff, viewed marks, batched comments -----------------------------

/**
 * What a Review panel reads: a project thread's worktree against the
 * project's base, or a PR review's (`review:<id>`) against the PR's base.
 */
async function reviewTarget(threadId: string) {
  const reviewId = reviewIdOfKey(threadId);
  if (reviewId) return reviewWorktree(reviewId);
  const found = await projectThread(threadId);
  if (!found?.thread.worktree) {
    throw Boom.notFound("Review against the base branch is for project threads with a worktree.");
  }
  return {
    worktree: found.thread.worktree,
    base: found.project.baseBranch,
    ws: await codeGitHub().workspace(found.project),
  };
}

/** A workspace failure the owner can act on, said as it is (409). */
function saying(error: unknown): never {
  if (error instanceof WorkspaceError) throw Boom.conflict(error.message);
  throw error;
}

/**
 * A PR review's other scopes, instead of since its base: `?since=review`,
 * since the commit of the owner's last review; `?since=mine`, what the owner
 * and the assistant changed on top of the PR's head.
 */
async function sinceReview(threadId: string, since: string | undefined) {
  if (since !== "review" && since !== "mine") return undefined;
  const reviewId = reviewIdOfKey(threadId);
  const review = reviewId ? await reviewWorktree(reviewId) : undefined;
  if (!review) throw Boom.badRequest("Only a pull request review has this view.");
  if (since === "mine") return review.headSha;
  if (!review.reviewedSha) throw Boom.badRequest("You have not reviewed this pull request yet.");
  return review.reviewedSha;
}

router.get("/code/threads/:id/review/files", async (c) => {
  const id = threadParam(c.req.param("id"));
  const [{ base, worktree, ws }, since] = await Promise.all([
    reviewTarget(id),
    sinceReview(id, c.req.query("since")),
  ]);
  const files = since
    ? await ws.sinceFiles(worktree, since).catch(saying)
    : await ws.baseFiles(worktree, base);
  return ok<ReviewFile[]>(c, await threadReview(id).withViewed(files));
});

router.get("/code/threads/:id/review/file", async (c) => {
  const id = threadParam(c.req.param("id"));
  const path = safePath(c.req.query("path"));
  const [{ base, worktree, ws }, since] = await Promise.all([
    reviewTarget(id),
    sinceReview(id, c.req.query("since")),
  ]);
  const sides = since
    ? await ws.sinceFile(worktree, since, path).catch(saying)
    : await ws.baseFile(worktree, base, path);
  return ok(c, { path, ...sides });
});

/**
 * The light editor's save: one file's whole new content, written in the
 * thread's (or PR review's) worktree when the file is still as the owner
 * opened it. An edit by the agent meanwhile is kept, and the owner is told
 * to open the file again. Only a regular file inside the worktree is written.
 */
router.put("/code/threads/:id/review/file", async (c) => {
  const id = threadParam(c.req.param("id"));
  const body = await parseBody(
    c,
    z.object({
      path: z.string().min(1).max(1024),
      original: z.string().max(MAX_EDIT_BYTES),
      content: z.string().max(MAX_EDIT_BYTES),
    }),
  );
  const path = safePath(body.path);
  const { worktree, ws } = await reviewTarget(id);
  const expected = createHash("sha256").update(body.original, "utf8").digest("hex");
  const outcome = await ws.writeFile(worktree, path, expected, body.content).catch(saying);
  if (outcome === "outside") {
    throw Boom.badRequest("Only a file inside the worktree can be edited here.");
  }
  if (outcome === "changed") {
    throw Boom.conflict(
      `${path} changed after you opened it (the agent may have edited it). Open it again to edit.`,
    );
  }
  return ok(c, { saved: true });
});

router.post("/code/threads/:id/review/viewed", async (c) => {
  const id = threadParam(c.req.param("id"));
  const body = await parseBody(
    c,
    z.object({
      path: z.string().min(1).max(1024),
      hash: z.string().min(1).max(64),
      viewed: z.boolean(),
    }),
  );
  await threadReview(id).markViewed(body.path, body.hash, body.viewed);
  return ok(c, { viewed: body.viewed });
});

router.get("/code/threads/:id/review/drafts", async (c) => {
  const id = threadParam(c.req.param("id"));
  return ok<ReviewDraft[]>(c, await threadReview(id).drafts());
});

const draftSchema = z.object({
  path: z.string().min(1).max(1024),
  side: z.enum(["old", "new"]).optional(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  quote: z.string().max(20_000).optional(),
  body: z.string().trim().min(1).max(20_000),
});

router.post("/code/threads/:id/review/drafts", async (c) => {
  const id = threadParam(c.req.param("id"));
  const body = await parseBody(c, draftSchema);
  return ok<ReviewDraft>(c, await threadReview(id).addDraft(body), 201);
});

router.delete("/code/threads/:id/review/drafts/:draft", async (c) => {
  const id = threadParam(c.req.param("id"));
  await threadReview(id).removeDraft(c.req.param("draft"));
  return ok(c, { deleted: true });
});

router.post("/code/threads/:id/review/send", async (c) => {
  const id = threadParam(c.req.param("id"));
  const { result, sent } = await threadReview(id).send(async (review) => {
    if (review === null) throw Boom.badRequest("No comments to send.");
    const target = codeHub()?.resolve(id);
    if (!target) throw Boom.notFound("No harness serves this thread");
    return target.instance.send(target.nativeId, { message: review });
  });
  return ok(c, { sent, status: result.status });
});

// --- PR reviews (issue #345) ----------------------------------------------------------------

router.get("/code/reviews", async (c) => ok<PullReviewView[]>(c, await listReviews()));

router.post("/code/reviews", async (c) => {
  const { pr } = await parseBody(c, z.object({ pr: z.string().trim().min(1).max(500) }));
  return ok<PullReviewView>(c, await openReview(pr), 201);
});

router.get("/code/reviews/inbox", async (c) => ok<InboxPullView[]>(c, await reviewInbox()));

router.get("/code/reviews/:review", async (c) =>
  ok<PullReviewView>(c, await getReview(c.req.param("review"))),
);

router.post("/code/reviews/:review/ask", async (c) => {
  const { message } = await parseBody(
    c,
    z.object({ message: z.string().trim().min(1).max(100_000) }),
  );
  return ok(c, await askReview(c.req.param("review"), message));
});

router.get("/code/reviews/:review/comments", async (c) =>
  ok<ReviewDraft[]>(c, await (await reviewComments(c.req.param("review"))).drafts()),
);

router.post("/code/reviews/:review/comments", async (c) => {
  const [body, comments] = await Promise.all([
    parseBody(c, draftSchema),
    reviewComments(c.req.param("review")),
  ]);
  return ok<ReviewDraft>(c, await comments.addDraft(body), 201);
});

router.delete("/code/reviews/:review/comments/:comment", async (c) => {
  const comments = await reviewComments(c.req.param("review"));
  await comments.removeDraft(c.req.param("comment"));
  return ok(c, { deleted: true });
});

router.post("/code/reviews/:review/comments/to-thread", async (c) =>
  ok(c, await sendCommentsToThread(c.req.param("review"))),
);

router.post("/code/reviews/:review/submit", async (c) => {
  const body = await parseBody(
    c,
    z.object({
      event: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
      body: z.string().max(65_000).optional(),
    }),
  );
  return ok(c, await submitReview(c.req.param("review"), body));
});

router.get("/code/reviews/:review/threads", async (c) =>
  ok<PullThreadsView>(c, await reviewThreads(c.req.param("review"))),
);

router.post("/code/reviews/:review/threads/:thread/reply", async (c) => {
  const { body } = await parseBody(c, z.object({ body: z.string().trim().min(1).max(65_000) }));
  await replyToReviewThread(c.req.param("review"), c.req.param("thread"), body);
  return ok(c, { replied: true });
});

router.post("/code/reviews/:review/threads/:thread/resolve", async (c) => {
  await resolveReviewThread(c.req.param("review"), c.req.param("thread"));
  return ok(c, { resolved: true });
});

router.post("/code/reviews/:review/push", async (c) => {
  const { message } = await parseBody(
    c,
    z.object({ message: z.string().trim().min(1).max(10_000) }),
  );
  return ok<PushedReview>(c, await pushReview(c.req.param("review"), message));
});

router.post("/code/reviews/:review/discard", async (c) => {
  await discardReviewChanges(c.req.param("review"));
  return ok(c, { discarded: true });
});

router.post("/code/reviews/:review/suggestions", async (c) =>
  ok<SuggestedChanges>(c, await suggestReviewChanges(c.req.param("review"))),
);

router.post("/code/reviews/:review/terminal", async (c) =>
  ok<ReviewTerminal>(c, await reviewTerminal(c.req.param("review")), 201),
);

router.post("/code/reviews/:review/archive", async (c) => {
  await archiveReview(c.req.param("review"));
  return ok(c, { archived: true });
});

export default router;
