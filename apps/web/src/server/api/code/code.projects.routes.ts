import { decideFinding, startAgentReview } from "./code.findings";
import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
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
  ReviewInboxSettings,
  PullReviewView,
  PullThreadsView,
  PushedReview,
  ReviewTerminal,
  WorktreeFile,
  FindingView,
  FileHit,
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
import { makeProjectChat, openProjectChat } from "./code.chat";
import { threadReview } from "./code.review";
import { checkpointRange, checkpointsOf, revertTo } from "./code.checkpoints";
import { codeHub } from "./code.hub";
import { checkLog } from "./code.checks";
import { cleanBranchPrefix, saying } from "./code.workspace";
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
  inboxSettings,
  inboxSettingsChange,
  saveInboxSettings,
  resolveReviewThread,
  reviewTerminal,
  reviewIdOfKey,
  reviewThreads,
  reviewWorktree,
  sendCommentsToThread,
  submitReview,
  suggestReviewChanges,
  terminalIn,
} from "./code.reviews";
import {
  createProject,
  deleteProject,
  listProjects,
  threadWorktree,
  projectView,
  updateProject,
} from "./code.projects";
import {
  editPull,
  linkPull,
  manualPass,
  mergePull,
  armYoloMerge,
  cancelYoloMerge,
  setPullDraft,
  publish,
  pushBase,
  setAutofix,
  threadPulls,
  unlinkPull,
} from "./code.pulls";

const router = new Hono<AppEnv>();

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
  let id: string;
  try {
    id = decodeURIComponent(raw ?? "");
  } catch {
    throw Boom.badRequest("Invalid thread");
  }
  if (!id || id.length > 300) throw Boom.badRequest("Invalid thread");
  return id;
};

router.get("/code/github", async (c) => ok<GitHubStatus>(c, await githubStatus()));

router.put("/code/github", async (c) => {
  const { token } = await parseBody(
    c,
    z.object({ token: z.string().trim().min(10).max(400).nullable() }),
  );
  await setGitHubToken(token);
  return ok<GitHubStatus>(c, await githubStatus());
});

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
  const project = await createProject(body);
  await makeProjectChat(project.id);
  return ok<ProjectView>(c, projectView(project), 201);
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
      draftPulls: z.boolean().optional(),
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
      workflowInstructions: z.string().trim().max(4000).optional(),
      instructions: z.string().trim().max(8000).optional(),
      autofix: z
        .strictObject({
          triggers: z
            .strictObject({
              checks: z.boolean().optional(),
              reviews: z.boolean().optional(),
              conflicts: z.boolean().optional(),
            })
            .optional(),
          trustedBots: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
          hourlyLimit: z.number().int().min(1).max(30).optional(),
          noOwnerLimit: z.number().int().min(1).max(50).optional(),
          passMinutes: z.number().int().min(5).max(120).optional(),
          onByDefault: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

router.patch("/code/projects/:project", async (c) => {
  const change = await parseBody(c, updateSchema);
  return ok<ProjectView>(c, projectView(await updateProject(c.req.param("project"), change)));
});

router.post("/code/projects/:project/chat", async (c) =>
  ok(c, await openProjectChat(c.req.param("project"))),
);

router.delete("/code/projects/:project", async (c) => {
  await deleteProject(c.req.param("project"));
  return ok(c, { deleted: true });
});

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
      commit: z.boolean().optional(),
    }),
  );
  await publish(id, body);
  return ok<ThreadPullsView>(c, await threadPulls(id, false), 201);
});

router.post("/code/threads/:id/push-base", async (c) => {
  const id = threadParam(c.req.param("id"));
  await pushBase(id);
  return ok<ThreadPullsView>(c, await threadPulls(id, false));
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

const workflowName = z.enum(["fix_ci", "address_comments", "resolve_conflicts"]);

router.post("/code/threads/:id/workflows/:name", async (c) => {
  const id = threadParam(c.req.param("id"));
  const name = workflowName.safeParse(c.req.param("name"));
  if (!name.success) throw Boom.notFound("No such workflow");
  const result = await manualPass(id, name.data);
  return ok(c, { ...result, view: await threadPulls(id, false) });
});

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
    z.object({ method: z.enum(["merge", "squash", "rebase"]).optional() }),
  );
  await mergePull(id, method);
  return ok<ThreadPullsView>(c, await threadPulls(id, false));
});

router.post("/code/threads/:id/pr/yolo", async (c) => {
  const id = threadParam(c.req.param("id"));
  const { method } = await parseBody(
    c,
    z.object({ method: z.enum(["merge", "squash", "rebase"]) }),
  );
  await armYoloMerge(id, method);
  return ok<ThreadPullsView>(c, await threadPulls(id, false));
});

router.delete("/code/threads/:id/pr/yolo", async (c) => {
  const id = threadParam(c.req.param("id"));
  await cancelYoloMerge(id);
  return ok<ThreadPullsView>(c, await threadPulls(id, false));
});

router.post("/code/threads/:id/pr/draft", async (c) => {
  const id = threadParam(c.req.param("id"));
  const { draft } = await parseBody(c, z.object({ draft: z.boolean() }));
  await setPullDraft(id, draft);
  return ok<ThreadPullsView>(c, await threadPulls(id, false));
});

async function reviewRange(threadId: string, scope = "base") {
  const reviewId = reviewIdOfKey(threadId);
  if (reviewId) {
    const review = await reviewWorktree(reviewId);
    const at = { ws: review.ws, worktree: review.worktree, viewable: true };
    if (scope === "base") return { ...at, from: `merge-base:${review.row.baseRef}` };
    if (scope === "mine") return { ...at, from: review.row.headSha };
    if (scope !== "review") throw Boom.badRequest("A pull request review has no such scope.");
    if (!review.row.reviewedSha) {
      throw Boom.badRequest("You have not reviewed this pull request yet.");
    }
    return { ...at, from: review.row.reviewedSha };
  }
  if (scope === "review" || scope === "mine") {
    throw Boom.badRequest("Only a pull request review has this view.");
  }
  if (scope !== "base") {
    const { from, to, worktree, ws } = await checkpointRange(threadId, scope);
    return { ws, worktree, from: from.sha, to: to.sha, viewable: false };
  }
  const { project, worktree, ws } = await threadWorktree(threadId);
  return { ws, worktree, from: `merge-base:${project.baseBranch}`, viewable: true };
}

router.get("/code/threads/:id/review/files", async (c) => {
  const id = threadParam(c.req.param("id"));
  const { ws, worktree, from, to, viewable } = await reviewRange(id, c.req.query("scope"));
  const files = to === from ? [] : await ws.files(worktree, from, to).catch(saying);
  return ok<ReviewFile[]>(
    c,
    viewable
      ? await threadReview(id).withViewed(files)
      : files.map((f) => ({ ...f, viewed: false })),
  );
});

router.get("/code/threads/:id/review/file", async (c) => {
  const id = threadParam(c.req.param("id"));
  const path = safePath(c.req.query("path"));
  const { ws, worktree, from, to } = await reviewRange(id, c.req.query("scope"));
  return ok(c, {
    path,
    ...(await ws.file(worktree, path, from, to).catch(saying)),
  });
});

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
  const { worktree, ws } = await reviewRange(id);
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

router.get("/code/threads/:id/files", async (c) => {
  const { worktree, ws } = await threadWorktree(threadParam(c.req.param("id")));
  return ok<string[]>(c, await ws.listFiles(worktree).catch(saying));
});

router.get("/code/threads/:id/files/content", async (c) => {
  const path = safePath(c.req.query("path"));
  const { worktree, ws } = await threadWorktree(threadParam(c.req.param("id")));
  const read = await ws.readText(worktree, path).catch(saying);
  if (read === "outside") throw Boom.notFound(`No file ${path} in this worktree.`);
  return ok<WorktreeFile>(
    c,
    read === "unshowable" ? { path, content: null } : { path, content: read.content },
  );
});

router.get("/code/threads/:id/files/search", async (c) => {
  const query = (c.req.query("q") ?? "").trim();
  if (query.length < 2 || query.length > 200)
    throw Boom.badRequest("Search for 2 to 200 characters.");
  const { worktree, ws } = await threadWorktree(threadParam(c.req.param("id")));
  return ok<FileHit[]>(c, await ws.search(worktree, query).catch(saying));
});

router.post("/code/threads/:id/terminal", async (c) => {
  const { worktree } = await threadWorktree(threadParam(c.req.param("id")));
  return ok<ReviewTerminal>(c, await terminalIn(worktree));
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

async function draftsOf(c: Context<AppEnv>) {
  const id = threadParam(c.req.param("id"));
  const target = c.req.query("target");
  if (target === undefined) return threadReview(id);
  if (target !== "github") throw Boom.badRequest("Unknown comment target.");
  const reviewId = reviewIdOfKey(id);
  if (!reviewId) throw Boom.badRequest("Only a pull request review has GitHub comments.");
  return reviewComments(reviewId);
}

router.get("/code/threads/:id/review/drafts", async (c) =>
  ok<ReviewDraft[]>(c, await (await draftsOf(c)).drafts()),
);

const draftSchema = z.object({
  path: z.string().min(1).max(1024),
  side: z.enum(["old", "new"]).optional(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  quote: z.string().max(20_000).optional(),
  body: z.string().trim().min(1).max(20_000),
});

router.post("/code/threads/:id/review/drafts", async (c) => {
  const [body, drafts] = await Promise.all([parseBody(c, draftSchema), draftsOf(c)]);
  return ok<ReviewDraft>(c, await drafts.addDraft(body), 201);
});

router.delete("/code/threads/:id/review/drafts/:draft", async (c) => {
  await (await draftsOf(c)).removeDraft(c.req.param("draft"));
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

router.get("/code/reviews", async (c) => ok<PullReviewView[]>(c, await listReviews()));

router.post("/code/reviews", async (c) => {
  const { pr } = await parseBody(c, z.object({ pr: z.string().trim().min(1).max(500) }));
  return ok<PullReviewView>(c, await openReview(pr), 201);
});

const inboxQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  repo: z.string().trim().min(1).max(200).optional(),
  drafts: z.enum(["hide"]).optional(),
});

router.get("/code/reviews/inbox", async (c) => {
  const query = inboxQuery.safeParse(c.req.query());
  if (!query.success) throw Boom.badRequest("Cannot read that filter.");
  return ok<InboxPullView[]>(c, await reviewInbox(query.data));
});

router.get("/code/reviews/settings", async (c) =>
  ok<ReviewInboxSettings>(c, await inboxSettings()),
);

router.put("/code/reviews/settings", async (c) => {
  const change = await parseBody(c, inboxSettingsChange);
  return ok<ReviewInboxSettings>(c, await saveInboxSettings(change));
});

router.get("/code/reviews/:review", async (c) =>
  ok<PullReviewView>(c, await getReview(c.req.param("review"))),
);

router.post("/code/reviews/:review/ask", async (c) => {
  const { message, model } = await parseBody(
    c,
    z.object({
      message: z.string().trim().min(1).max(100_000),
      model: z.string().trim().min(1).max(200).optional(),
    }),
  );
  return ok(c, await askReview(c.req.param("review"), message, model));
});

router.post("/code/reviews/:review/agent-review", async (c) =>
  ok(c, await startAgentReview(c.req.param("review"))),
);

router.post("/code/reviews/:review/findings/:finding", async (c) => {
  const decision = await parseBody(
    c,
    z.union([
      z.object({ action: z.literal("add"), body: z.string().max(10_000).optional() }),
      z.object({ action: z.literal("dismiss") }),
    ]),
  );
  return ok<FindingView[]>(
    c,
    await decideFinding(c.req.param("review"), c.req.param("finding"), decision),
  );
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
