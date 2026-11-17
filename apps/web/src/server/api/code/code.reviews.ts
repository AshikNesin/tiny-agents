/**
 * PR reviews (issue #345): review any pull request of a project's
 * repository, the owner's own or someone else's, with an assistant scoped
 * to it.
 *
 * Opening a review fetches the PR's head (`refs/pull/N/head`, so a PR from
 * a fork works) and checks it out in a detached worktree of its own; the
 * file list and diffs come from git there, against the PR's base. None of
 * that calls a model. The assistant is a thread of the project's default
 * harness, started in that worktree on the owner's first question, whose
 * first message carries a compact card of the PR (`reviewCard`: title,
 * author, branches, the description cut short, the file list with +/−),
 * never the diff: the assistant reads what it needs with its own tools.
 *
 * Until the assistant exists, viewed marks and line comments are kept under
 * the review's key (`review:<id>`), and those comments go with the first
 * question.
 *
 * Review comments for GitHub wait under the same key, apart from the
 * assistant's (`threadReview(key, "github")`), until the owner submits the
 * review: one REST call posts them all with the verdict, pinned to the head
 * the owner read. On their own PR GitHub allows only a comment, and if a
 * Code thread opened that PR the comments can go to it instead.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import {
  repoSlug,
  type PullSnapshot,
  type RepoRef,
  type ReviewCommentInput,
} from "@tiny-agents/github";
import { threadIdOf } from "@tiny-agents/code/server";
import {
  codeProjects,
  codePullRequests,
  codeReviews,
  codeThreads,
  db,
  type CodeProjectRow,
} from "../../db";
import type {
  InboxPullView,
  PullReviewView,
  PullThreadsView,
  ReviewDraft,
  ReviewVerdict,
} from "../../../shared/api/code";
import { reviewCard } from "../../../shared/code-messages";
import { codeGitHub } from "./code.github";
import { codeHub } from "./code.hub";
import { applyTitle } from "./code.naming";
import { repoOf } from "./code.projects";
import { threadReview } from "./code.review";
import { follow } from "./code.store";

type CodeReviewRow = typeof codeReviews.$inferSelect;

const KEY_PREFIX = "review:";

/** Where a review's viewed marks and early comments are kept: `review:<id>`. */
const reviewKey = (id: string) => `${KEY_PREFIX}${id}`;

/** The review id behind a key from `reviewKey`, or undefined for a thread id. */
export const reviewIdOfKey = (key: string) =>
  key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : undefined;

/**
 * A pull request named the ways people paste one: its GitHub URL (any tab
 * of it), `owner/name#12` or `owner/name/pull/12`.
 */
function parsePullRef(input: string): { repo: RepoRef; number: number } | undefined {
  const match =
    /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(?:#|\/pulls?\/)(\d{1,9})(?:[/?#].*)?$/.exec(
      input.trim(),
    );
  if (!match || match[2] === "." || match[2] === "..") return undefined;
  const number = Number(match[3]);
  return number > 0 ? { repo: { owner: match[1]!, name: match[2]! }, number } : undefined;
}

const reviewPath = (project: CodeProjectRow, number: number) =>
  `${project.checkoutPath.replace(/\/checkout$/, "")}/reviews/pr-${number}`;

/** The Code thread that opened PR `number` of the project, if one did. */
async function codingThreadOf(projectId: string, number: number): Promise<string | null> {
  const pull = await db.query.codePullRequests.findFirst({
    where: and(eq(codePullRequests.projectId, projectId), eq(codePullRequests.number, number)),
    orderBy: desc(codePullRequests.createdAt),
  });
  return pull?.threadId ?? null;
}

async function reviewView(row: CodeReviewRow, project: CodeProjectRow): Promise<PullReviewView> {
  return {
    id: row.id,
    key: reviewKey(row.id),
    projectId: project.id,
    repo: repoSlug(repoOf(project)),
    number: row.number,
    url: row.url,
    title: row.title,
    author: row.author,
    headRef: row.headRef,
    baseRef: row.baseRef,
    headSha: row.headSha,
    fromFork: row.fromFork,
    mine: row.mine,
    threadId: row.threadId,
    codingThreadId: await codingThreadOf(project.id, row.number),
    archived: row.archivedAt !== null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function projectFor(repo: RepoRef): Promise<CodeProjectRow> {
  const project = await db.query.codeProjects.findFirst({
    where: and(eq(codeProjects.repoOwner, repo.owner), eq(codeProjects.repoName, repo.name)),
  });
  if (!project) {
    throw Boom.notFound(
      `${repoSlug(repo)} is not a project yet. Add it in Code settings → Projects first.`,
    );
  }
  return project;
}

/**
 * Open a review of a pull request (idempotent): read it from GitHub, check
 * its head out in the review's worktree, and keep what the page shows. An
 * open review of the same PR is brought to the PR's current head (unless
 * its worktree has changes) and reused; an archived one is opened again.
 */
export async function openReview(input: string): Promise<PullReviewView> {
  const ref = parsePullRef(input);
  if (!ref) throw Boom.badRequest("Give a pull request as its GitHub URL or owner/name#123.");
  const project = await projectFor(ref.repo);
  const services = codeGitHub();
  const github = await services.client(project);
  let pr: PullSnapshot;
  try {
    pr = await github.snapshot(ref.repo, ref.number);
  } catch (error) {
    throw Boom.badRequest(
      `Cannot read ${repoSlug(ref.repo)}#${ref.number} on GitHub: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const [viewer, ws] = await Promise.all([
    github.viewer().catch(() => undefined),
    services.workspace(project),
  ]);
  const path = reviewPath(project, pr.number);
  const headSha = await ws.pullWorktree(project.checkoutPath, path, pr.number, pr.baseRef);
  const values = {
    url: pr.url,
    title: pr.title,
    author: pr.author ?? "",
    headRef: pr.headRef,
    baseRef: pr.baseRef,
    headSha,
    fromFork: pr.fromFork,
    mine: !!viewer && !!pr.author && viewer.login.toLowerCase() === pr.author.toLowerCase(),
    worktree: path,
    archivedAt: null,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(codeReviews)
    .values({ projectId: project.id, number: pr.number, ...values })
    .onConflictDoUpdate({ target: [codeReviews.projectId, codeReviews.number], set: values })
    .returning();
  return reviewView(row!, project);
}

/** Open reviews, most recently opened first. */
export async function listReviews(): Promise<PullReviewView[]> {
  const rows = await db
    .select({ review: codeReviews, project: codeProjects })
    .from(codeReviews)
    .innerJoin(codeProjects, eq(codeProjects.id, codeReviews.projectId))
    .where(isNull(codeReviews.archivedAt))
    .orderBy(desc(codeReviews.updatedAt));
  return Promise.all(rows.map((r) => reviewView(r.review, r.project)));
}

async function findReview(id: string): Promise<{ row: CodeReviewRow; project: CodeProjectRow }> {
  const row = await db.query.codeReviews.findFirst({ where: eq(codeReviews.id, id) });
  if (!row) throw Boom.notFound("No such review");
  const project = await db.query.codeProjects.findFirst({
    where: eq(codeProjects.id, row.projectId),
  });
  if (!project) throw Boom.notFound("No such review");
  return { row, project };
}

export async function getReview(id: string): Promise<PullReviewView> {
  const { row, project } = await findReview(id);
  return reviewView(row, project);
}

/** What the review's file list and diffs read: its worktree, against the PR's base. */
export async function reviewWorktree(id: string) {
  const { row, project } = await findReview(id);
  if (!row.worktree) throw Boom.notFound("This review is archived. Open the PR again.");
  return {
    worktree: row.worktree,
    base: row.baseRef,
    ws: await codeGitHub().workspace(project),
  };
}

/**
 * The owner's question to the review's assistant. The first one starts the
 * assistant in the review's worktree, with the PR card and any line comments
 * ahead of the question; a later one goes to that thread like any message.
 */
export async function askReview(id: string, question: string): Promise<{ threadId: string }> {
  const hub = codeHub();
  if (!hub) throw Boom.notFound("No coding agent is connected.");
  return hub.serial(reviewKey(id), async () => {
    const { row, project } = await findReview(id);
    if (!row.worktree) throw Boom.badRequest("This review is archived. Open the PR again.");
    const known = row.threadId ? hub.resolve(row.threadId) : undefined;
    const { result } = await threadReview(reviewKey(id)).send(async (comments) => {
      const message = comments ? `${comments}\n\n---\n\n${question}` : question;
      if (known) {
        await known.instance.send(known.nativeId, { message });
        return row.threadId!;
      }
      return startAssistant(row, project, row.worktree!, message);
    });
    return { threadId: result };
  });
}

async function startAssistant(
  row: CodeReviewRow,
  project: CodeProjectRow,
  worktree: string,
  message: string,
): Promise<string> {
  const hub = codeHub()!;
  const instance =
    (project.defaultInstanceId ? hub.instance(project.defaultInstanceId) : undefined) ??
    hub.instances()[0];
  if (!instance) throw Boom.notFound("No coding agent is connected.");
  const ws = await codeGitHub().workspace(project);
  const files = await ws.baseFiles(worktree, row.baseRef);
  const card = reviewCard({
    repo: repoSlug(repoOf(project)),
    number: row.number,
    title: row.title,
    author: row.author,
    headRef: row.headRef,
    baseRef: row.baseRef,
    headSha: row.headSha,
    body: await pullBody(project, row.number),
    files,
  });
  const caps = instance.capabilities();
  // Edits wait for the owner's yes: the assistant reads, it does not change the PR.
  const permissionMode = caps.settings.permissionModes.includes("default")
    ? ("default" as const)
    : undefined;
  const { nativeId } = await instance.createThread({
    cwd: worktree,
    message: `${card}\n\n${message}`,
    model: project.defaultModel ?? undefined,
    ...(permissionMode ? { permissionMode } : {}),
  });
  const threadId = threadIdOf(instance.id, nativeId);
  await applyTitle(instance, nativeId, `Review #${row.number}: ${row.title}`.slice(0, 80));
  await follow(instance.id, nativeId);
  await db.update(codeThreads).set({ cwd: worktree }).where(eq(codeThreads.id, threadId));
  await db
    .update(codeReviews)
    .set({ threadId, updatedAt: new Date() })
    .where(eq(codeReviews.id, row.id));
  void hub.refresh(instance.id);
  return threadId;
}

/** The PR's description, read when the assistant starts (it is not kept). */
async function pullBody(project: CodeProjectRow, number: number): Promise<string> {
  try {
    const github = await codeGitHub().client(project);
    return (await github.snapshot(repoOf(project), number)).body;
  } catch (error) {
    logger.warn({ error, number }, "Code: could not read the PR description for the review");
    return "";
  }
}

/**
 * Close a review: its worktree goes (and with it anything changed there),
 * and its assistant is archived where the harness archives. Opening the PR
 * again starts from its current head.
 */
export async function archiveReview(id: string): Promise<void> {
  const { row, project } = await findReview(id);
  if (row.worktree) {
    const ws = await codeGitHub().workspace(project);
    await ws.removeWorktree(project.checkoutPath, row.worktree);
  }
  const assistant = row.threadId ? codeHub()?.resolve(row.threadId) : undefined;
  if (assistant?.instance.archive) {
    await assistant.instance.archive(assistant.nativeId, true).catch((error: unknown) => {
      logger.warn({ error, threadId: row.threadId }, "Code: could not archive the review thread");
    });
  }
  await db
    .update(codeReviews)
    .set({ worktree: null, archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(codeReviews.id, id));
}

// --- review comments for GitHub, and submitting the review ----------------------------------

/** The review's pending GitHub comments (404 for no such review). */
export async function reviewComments(id: string) {
  await findReview(id);
  return threadReview(reviewKey(id), "github");
}

/** GitHub's side and lines for a saved comment: the old side is LEFT, a range ends at `line`. */
function toGitHubComment(d: ReviewDraft): ReviewCommentInput {
  return {
    path: d.path,
    side: d.side === "old" ? "LEFT" : "RIGHT",
    line: d.endLine,
    ...(d.startLine !== d.endLine ? { startLine: d.startLine } : {}),
    body: d.body,
  };
}

/**
 * Submit the review on GitHub with every pending comment, at the head the
 * worktree shows (so each comment lands on the lines the owner read).
 */
export async function submitReview(
  id: string,
  input: { event: ReviewVerdict; body?: string },
): Promise<{ url: string; comments: number }> {
  const { row, project } = await findReview(id);
  if (row.mine && input.event !== "COMMENT") {
    throw Boom.badRequest(
      "GitHub does not let you approve or request changes on your own pull request. Submit it as a comment.",
    );
  }
  const body = input.body?.trim() ?? "";
  if (input.event === "REQUEST_CHANGES" && !body) {
    throw Boom.badRequest("Say what to change: GitHub needs a summary to request changes.");
  }
  const github = await codeGitHub().client(project);
  const { result, sent } = await threadReview(reviewKey(id), "github").send(
    async (_message, drafts) => {
      if (input.event === "COMMENT" && !body && drafts.length === 0) {
        throw Boom.badRequest("Add a comment or a summary first.");
      }
      return github.submitReview(repoOf(project), row.number, {
        commitId: row.headSha,
        event: input.event,
        body,
        comments: drafts.map(toGitHubComment),
      });
    },
  );
  await db.update(codeReviews).set({ updatedAt: new Date() }).where(eq(codeReviews.id, id));
  return { url: result.url, comments: sent };
}

/** Hand the pending comments to the Code thread that opened the PR, as one message. */
export async function sendCommentsToThread(
  id: string,
): Promise<{ threadId: string; sent: number }> {
  const { row, project } = await findReview(id);
  const threadId = await codingThreadOf(project.id, row.number);
  const target = threadId ? codeHub()?.resolve(threadId) : undefined;
  if (!threadId || !target) throw Boom.notFound("No Code thread opened this pull request.");
  const { sent } = await threadReview(reviewKey(id), "github").send(async (message) => {
    if (message === null) throw Boom.badRequest("No comments to send.");
    await target.instance.send(target.nativeId, { message });
  });
  return { threadId, sent };
}

// --- the PR's conversations on GitHub --------------------------------------------------------

/**
 * The PR's line conversations, read from GitHub when the page asks (one
 * query, no model). Lines are at the PR's current head, which the page
 * compares with the head its worktree shows.
 */
export async function reviewThreads(id: string): Promise<PullThreadsView> {
  const { row, project } = await findReview(id);
  const github = await codeGitHub().client(project);
  const pr = await github.snapshot(repoOf(project), row.number);
  return {
    headSha: pr.headSha,
    threads: pr.threads.map((t) => ({
      id: t.id,
      path: t.path,
      side: t.side === "LEFT" ? "old" : "new",
      line: t.line,
      startLine: t.startLine ?? null,
      resolved: t.resolved,
      outdated: t.outdated,
      comments: t.comments.map((c) => ({
        id: c.id,
        author: c.author.login,
        bot: c.author.type === "bot",
        body: c.body,
        createdAt: c.createdAt,
      })),
    })),
  };
}

/** Reply on one of the PR's conversations, as the GitHub account Code uses. */
export async function replyToReviewThread(id: string, threadId: string, body: string) {
  const { project } = await findReview(id);
  const github = await codeGitHub().client(project);
  await github.replyToThread(threadId, body);
}

export async function resolveReviewThread(id: string, threadId: string) {
  const { project } = await findReview(id);
  const github = await codeGitHub().client(project);
  await github.resolveThread(threadId);
}

// --- the review inbox ----------------------------------------------------------------------------

/**
 * The owner's review inbox from GitHub, across every repository their
 * credential sees (one query, no model): what asks for their review, what
 * changed since they reviewed, what waits on its author, and their own.
 * Each says whether its repository is a project, and its open review here.
 */
export async function reviewInbox(): Promise<InboxPullView[]> {
  const github = await codeGitHub().client();
  let pulls;
  try {
    pulls = await github.reviewInbox();
  } catch (error) {
    throw Boom.badRequest(
      `Cannot read your review requests on GitHub: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const [projects, open] = await Promise.all([
    db.select().from(codeProjects),
    db.select().from(codeReviews).where(isNull(codeReviews.archivedAt)),
  ]);
  const projectOf = new Map(
    projects.map((p) => [`${p.repoOwner}/${p.repoName}`.toLowerCase(), p.id]),
  );
  const reviewOf = new Map(open.map((r) => [`${r.projectId}#${r.number}`, r.id]));
  return pulls.map((pr) => {
    const projectId = projectOf.get(repoSlug(pr.repo).toLowerCase()) ?? null;
    const section: InboxPullView["section"] =
      pr.reason === "requested"
        ? "needs"
        : pr.reason === "authored"
          ? "mine"
          : pr.lastReview?.commit && pr.lastReview.commit !== pr.headSha
            ? "updated"
            : "waiting";
    return {
      section,
      repo: repoSlug(pr.repo),
      number: pr.number,
      title: pr.title,
      url: pr.url,
      author: pr.author,
      draft: pr.draft,
      updatedAt: pr.updatedAt,
      decision: pr.decision,
      lastReviewAt: pr.lastReview?.at ?? null,
      projectId,
      reviewId: projectId ? (reviewOf.get(`${projectId}#${pr.number}`) ?? null) : null,
    };
  });
}
