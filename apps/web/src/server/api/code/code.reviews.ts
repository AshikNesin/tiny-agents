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
  parseRepo,
  repoSlug,
  type InboxFilter,
  type PullSnapshot,
  type RepoRef,
  type ReviewCommentInput,
} from "@tiny-agents/github";
import type { Hunk } from "@tiny-agents/git";
import { threadIdOf } from "@tiny-agents/code/server";
import {
  codeProjects,
  codePullRequests,
  codeReviews,
  codeThreads,
  db,
  type CodeProjectRow,
} from "../../db";
import { shQuote } from "@tiny-agents/sandbox";
import {
  SessionLimitError,
  TerminalUnreachableError,
  TmuxMissingError,
} from "@tiny-agents/sandbox/terminal";
import type {
  InboxPullView,
  InboxQuery,
  PullReviewView,
  PullThreadsView,
  PushedReview,
  ReviewDraft,
  ReviewTerminal,
  ReviewVerdict,
  SuggestedChanges,
} from "../../../shared/api/code";
import { getTerminalService } from "../terminal/terminal.instance";
import { reviewCard } from "../../../shared/code-messages";
import { codeGitHub } from "./code.github";
import { codeHub } from "./code.hub";
import { applyTitle } from "./code.naming";
import { repoOf } from "./code.projects";
import { threadReview, type DraftInput } from "./code.review";
import { follow } from "./code.store";
import { WorkspaceError } from "./code.workspace";

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

/** The commit of `login`'s latest review of the PR that names one. */
function lastReviewed(pr: PullSnapshot, login: string): string | null {
  const mine = pr.reviews
    .filter((r) => r.commit && r.author.login.toLowerCase() === login.toLowerCase())
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  return mine.at(-1)?.commit ?? null;
}

/** The Code thread that opened PR `number` of the project, if one did. */
async function codingThreadOf(projectId: string, number: number): Promise<string | null> {
  const pull = await db.query.codePullRequests.findFirst({
    where: and(eq(codePullRequests.projectId, projectId), eq(codePullRequests.number, number)),
    orderBy: desc(codePullRequests.createdAt),
  });
  return pull?.threadId ?? null;
}

/** The harness a review's assistant starts on: the project's default, else the first. */
function assistantInstance(project: CodeProjectRow) {
  const hub = codeHub();
  if (!hub) return undefined;
  return (
    (project.defaultInstanceId ? hub.instance(project.defaultInstanceId) : undefined) ??
    hub.instances()[0]
  );
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
    reviewedSha: row.reviewedSha,
    threadId: row.threadId,
    codingThreadId: await codingThreadOf(project.id, row.number),
    assistant: (() => {
      const instance = assistantInstance(project);
      return instance ? { instanceId: instance.id, model: project.defaultModel ?? null } : null;
    })(),
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
    ...(viewer ? { reviewedSha: lastReviewed(pr, viewer.login) } : {}),
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

/**
 * What the review's file list and diffs read: its worktree, against the
 * PR's base, or (`since`) against the commit of the owner's last review.
 */
export async function reviewWorktree(id: string) {
  const { row, project } = await findReview(id);
  if (!row.worktree) throw Boom.notFound("This review is archived. Open the PR again.");
  return {
    worktree: row.worktree,
    base: row.baseRef,
    headSha: row.headSha,
    reviewedSha: row.reviewedSha,
    ws: await codeGitHub().workspace(project),
  };
}

/**
 * The owner's question to the review's assistant. The first one starts the
 * assistant in the review's worktree, with the PR card and any line comments
 * ahead of the question; a later one goes to that thread like any message.
 */
export async function askReview(
  id: string,
  question: string,
  model?: string,
): Promise<{ threadId: string }> {
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
      return startAssistant(row, project, row.worktree!, message, model);
    });
    return { threadId: result };
  });
}

async function startAssistant(
  row: CodeReviewRow,
  project: CodeProjectRow,
  worktree: string,
  message: string,
  model: string | undefined,
): Promise<string> {
  const hub = codeHub()!;
  const instance = assistantInstance(project);
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
    model: model ?? project.defaultModel ?? undefined,
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
  await db
    .update(codeReviews)
    .set({ reviewedSha: row.headSha, updatedAt: new Date() })
    .where(eq(codeReviews.id, id));
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
 * `query` narrows GitHub's searches themselves, so a filter reaches past the
 * first page of each.
 */
export async function reviewInbox(query: InboxQuery = {}): Promise<InboxPullView[]> {
  const projects = await db.select().from(codeProjects);
  const filter: InboxFilter = {};
  if (query.days) {
    filter.updatedSince = new Date(Date.now() - query.days * 86_400_000).toISOString().slice(0, 10);
  }
  if (query.repo === "projects") {
    if (projects.length === 0) return [];
    filter.repos = projects.map((p) => ({ owner: p.repoOwner, name: p.repoName }));
  } else if (query.repo) {
    const repo = parseRepo(query.repo);
    if (!repo) throw Boom.badRequest(`Not a repository: ${query.repo}`);
    filter.repos = [repo];
  }
  if (query.drafts === "hide") filter.drafts = false;
  const github = await codeGitHub().client();
  let pulls;
  try {
    pulls = await github.reviewInbox(filter);
  } catch (error) {
    throw Boom.badRequest(
      `Cannot read your review requests on GitHub: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const open = await db.select().from(codeReviews).where(isNull(codeReviews.archivedAt));
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

// --- changing the PR's code -------------------------------------------------------------------

/** A review with a worktree to change, its project and its workspace. */
async function openWorktree(id: string) {
  const { row, project } = await findReview(id);
  if (!row.worktree) throw Boom.badRequest("This review is archived. Open the PR again.");
  return {
    row,
    project,
    worktree: row.worktree,
    ws: await codeGitHub().workspace(project),
  };
}

/** A git failure the owner can act on, said as it is (409). */
function saying(error: unknown): never {
  if (error instanceof WorkspaceError) throw Boom.conflict(error.message);
  throw error;
}

/**
 * Commit what the owner and the assistant changed in the review's worktree
 * and push it to the PR's branch, never forced: GitHub rejects the push when
 * the branch moved on. A fork's branch takes it only when its author allows
 * edits from maintainers.
 */
export async function pushReview(id: string, message: string): Promise<PushedReview> {
  const { row, project, worktree, ws } = await openWorktree(id);
  const github = await codeGitHub().client(project);
  const pr = await github.snapshot(repoOf(project), row.number);
  if (pr.state !== "open") {
    throw Boom.badRequest("This pull request is closed: there is no branch to push to.");
  }
  if (!pr.headRepo) throw Boom.badRequest("The pull request's branch was deleted.");
  if (pr.fromFork && !pr.maintainerCanModify) {
    throw Boom.badRequest(
      `@${pr.author ?? row.author}'s fork does not allow edits from maintainers, so you cannot push to it. Post your changes as suggestions instead.`,
    );
  }
  const [dirty, head, viewer] = await Promise.all([
    ws.uncommitted(worktree),
    ws.headSha(worktree),
    github.viewer().catch(() => undefined),
  ]);
  if (dirty.length === 0 && head === row.headSha) {
    throw Boom.badRequest("You have not changed anything in this pull request.");
  }
  if (dirty.length > 0) {
    const login = viewer?.login ?? "tiny-agents";
    await ws
      .commitAll(worktree, message, {
        name: login,
        email: `${login}@users.noreply.github.com`,
      })
      .catch(saying);
  }
  const sha = await ws.push(worktree, pr.headRepo, pr.headRef).catch(saying);
  await db
    .update(codeReviews)
    .set({ headSha: sha, updatedAt: new Date() })
    .where(eq(codeReviews.id, id));
  return { sha, branch: pr.headRef };
}

/** Put the review's worktree back at the PR's head. */
export async function discardReviewChanges(id: string): Promise<void> {
  const { row, worktree, ws } = await openWorktree(id);
  await ws.discard(worktree, row.headSha).catch(saying);
}

/** A suggestion block of `lines`, fenced longer than any fence inside them. */
function suggestion(lines: string[]): string {
  const longest = Math.max(2, ...lines.map((l) => /^`{3,}/.exec(l)?.[0].length ?? 0));
  const fence = "`".repeat(longest + 1);
  return `${fence}suggestion\n${lines.map((l) => `${l}\n`).join("")}${fence}`;
}

/**
 * The owner's changes as pending suggestion comments, one per hunk, on the
 * PR head's lines each replaces (an added line is suggested with the line it
 * follows), for when they cannot push. GitHub takes a comment only on lines
 * of the PR's own diff, so a hunk outside it, or in a file the owner added
 * or deleted, is skipped and counted.
 */
export async function suggestReviewChanges(id: string): Promise<SuggestedChanges> {
  const { row, worktree, ws } = await openWorktree(id);
  const files = await ws.sinceFiles(worktree, row.headSha).catch(saying);
  const read = await Promise.all(
    files.map(async (file) => {
      if (file.status !== "modified" || file.binary) return { drafts: [], skipped: 1 };
      const [mine, pull, sides] = await Promise.all([
        ws.hunks(worktree, file.path, row.headSha, null),
        ws.hunks(worktree, file.path, `merge-base:${row.baseRef}:${row.headSha}`, row.headSha, 3),
        ws.sinceFile(worktree, row.headSha, file.path),
      ]);
      return suggestionsFor(file.path, mine, pull, sides.oldContent.split("\n"));
    }),
  );
  const drafts = read.flatMap((r) => r.drafts);
  const comments = threadReview(reviewKey(id), "github");
  // One at a time, so they list in the order of the diff.
  await drafts.reduce<Promise<unknown>>(
    (previous, draft) => previous.then(() => comments.addDraft(draft)),
    Promise.resolve(),
  );
  const skipped = read.reduce((sum, r) => sum + r.skipped, 0);
  return { added: drafts.length, skipped };
}

/** One file's hunks as suggestions on the PR head's lines, those GitHub can take. */
function suggestionsFor(path: string, mine: Hunk[], pull: Hunk[], headLines: string[]) {
  const drafts: DraftInput[] = [];
  let skipped = 0;
  for (const hunk of mine) {
    const insertion = hunk.oldCount === 0;
    const start = insertion ? Math.max(hunk.oldStart, 1) : hunk.oldStart;
    const end = insertion ? start : hunk.oldStart + hunk.oldCount - 1;
    const inDiff = pull.some(
      (p) => p.newCount > 0 && start >= p.newStart && end < p.newStart + p.newCount,
    );
    if (!inDiff) {
      skipped += 1;
      continue;
    }
    const anchor = headLines[start - 1] ?? "";
    const lines = !insertion
      ? hunk.added
      : hunk.oldStart === 0
        ? [...hunk.added, anchor]
        : [anchor, ...hunk.added];
    drafts.push({
      path,
      side: "new",
      startLine: start,
      endLine: end,
      quote: headLines.slice(start - 1, end).join("\n"),
      body: suggestion(lines),
    });
  }
  return { drafts, skipped };
}

/** A Terminal tab that starts in the review's worktree. */
export async function reviewTerminal(id: string): Promise<ReviewTerminal> {
  const { worktree } = await openWorktree(id);
  try {
    const tab = await getTerminalService().create(120, 34, {
      typeLine: `cd ${shQuote(worktree)}`,
    });
    return { name: tab.name };
  } catch (error) {
    if (error instanceof SessionLimitError) throw Boom.conflict(error.message);
    if (error instanceof TmuxMissingError || error instanceof TerminalUnreachableError) {
      throw Boom.unavailable(error.message);
    }
    throw error;
  }
}
