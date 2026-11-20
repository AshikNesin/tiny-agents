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
import { saying, type Workspace } from "./code.workspace";

type CodeReviewRow = typeof codeReviews.$inferSelect;

const KEY_PREFIX = "review:";

const reviewKey = (id: string) => `${KEY_PREFIX}${id}`;

export const reviewIdOfKey = (key: string) =>
  key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : undefined;

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

function lastReviewed(pr: PullSnapshot, login: string): string | null {
  const mine = pr.reviews
    .filter((r) => r.commit && r.author.login.toLowerCase() === login.toLowerCase())
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  return mine.at(-1)?.commit ?? null;
}

async function codingThreadOf(projectId: string, number: number): Promise<string | null> {
  const pull = await db.query.codePullRequests.findFirst({
    where: and(eq(codePullRequests.projectId, projectId), eq(codePullRequests.number, number)),
    orderBy: desc(codePullRequests.createdAt),
  });
  return pull?.threadId ?? null;
}

function assistantInstance(project: CodeProjectRow) {
  const hub = codeHub();
  if (!hub) return undefined;
  return (
    (project.defaultInstanceId ? hub.instance(project.defaultInstanceId) : undefined) ??
    hub.instances()[0]
  );
}

async function threadWorktreeAt(
  project: CodeProjectRow,
  pr: PullSnapshot,
  head: string,
  ws: Workspace,
): Promise<string | undefined> {
  if (pr.fromFork) return undefined;
  const threadId = await codingThreadOf(project.id, pr.number);
  if (!threadId) return undefined;
  const thread = await db.query.codeThreads.findFirst({ where: eq(codeThreads.id, threadId) });
  if (!thread?.worktree || thread.branch !== pr.headRef) return undefined;
  if (!(await ws.exists(thread.worktree))) return undefined;
  const at = await ws.headSha(thread.worktree).catch(() => undefined);
  return at === head ? thread.worktree : undefined;
}

async function worktreeThreadOf(row: CodeReviewRow, project: CodeProjectRow) {
  if (!row.worktree || row.worktree === reviewPath(project, row.number)) return null;
  const thread = await db.query.codeThreads.findFirst({
    where: eq(codeThreads.worktree, row.worktree),
  });
  return thread?.id ?? null;
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
    worktreeThreadId: await worktreeThreadOf(row, project),
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
  const own = reviewPath(project, pr.number);
  const head = await ws.fetchPull(project.checkoutPath, pr.number, pr.baseRef);
  const [shared, existing] = await Promise.all([
    threadWorktreeAt(project, pr, head, ws),
    db.query.codeReviews.findFirst({
      where: and(eq(codeReviews.projectId, project.id), eq(codeReviews.number, pr.number)),
    }),
  ]);
  const hadOwn = existing?.worktree === own && (await ws.exists(own));
  const ownDirty = hadOwn && (await ws.uncommitted(own)).length > 0;
  let path = own;
  let headSha: string;
  if (shared && !ownDirty) {
    if (hadOwn) await ws.removeWorktree(project.checkoutPath, own);
    path = shared;
    headSha = head;
  } else {
    headSha = await ws.pullWorktree(project.checkoutPath, own, head);
  }
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

function worktreeOf(row: CodeReviewRow): string {
  if (!row.worktree) throw Boom.notFound("This review is archived. Open the PR again.");
  return row.worktree;
}

export async function reviewWorktree(id: string) {
  const { row, project } = await findReview(id);
  const worktree = worktreeOf(row);
  return { row, project, worktree, ws: await codeGitHub().workspace(project) };
}

export async function askReview(
  id: string,
  question: string,
  model?: string,
): Promise<{ threadId: string }> {
  const hub = codeHub();
  if (!hub) throw Boom.notFound("No coding agent is connected.");
  return hub.serial(reviewKey(id), async () => {
    const { row, project } = await findReview(id);
    const worktree = worktreeOf(row);
    const known = row.threadId ? hub.resolve(row.threadId) : undefined;
    const { result } = await threadReview(reviewKey(id)).send(async (comments) => {
      const message = comments ? `${comments}\n\n---\n\n${question}` : question;
      if (known) {
        await known.instance.send(known.nativeId, { message });
        return row.threadId!;
      }
      return startAssistant(row, project, worktree, message, model);
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
  const files = await ws.files(worktree, `merge-base:${row.baseRef}`);
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

async function pullBody(project: CodeProjectRow, number: number): Promise<string> {
  try {
    const github = await codeGitHub().client(project);
    return (await github.snapshot(repoOf(project), number)).body;
  } catch (error) {
    logger.warn({ error, number }, "Code: could not read the PR description for the review");
    return "";
  }
}

export async function archiveReview(id: string): Promise<void> {
  const { row, project } = await findReview(id);
  if (row.worktree === reviewPath(project, row.number)) {
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

export async function reviewComments(id: string) {
  await findReview(id);
  return threadReview(reviewKey(id), "github");
}

function toGitHubComment(d: ReviewDraft): ReviewCommentInput {
  return {
    path: d.path,
    side: d.side === "old" ? "LEFT" : "RIGHT",
    line: d.endLine,
    ...(d.startLine !== d.endLine ? { startLine: d.startLine } : {}),
    body: d.body,
  };
}

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

async function ownWorktree(id: string) {
  const found = await reviewWorktree(id);
  if (found.worktree !== reviewPath(found.project, found.row.number)) {
    throw Boom.conflict(
      "This review shows the coding thread's worktree, so these changes are that thread's. Discard or push them from the thread.",
    );
  }
  return found;
}

export async function pushReview(id: string, message: string): Promise<PushedReview> {
  const { row, project, worktree, ws } = await ownWorktree(id);
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

export async function discardReviewChanges(id: string): Promise<void> {
  const { row, worktree, ws } = await ownWorktree(id);
  await ws.discard(worktree, row.headSha).catch(saying);
}

function suggestion(lines: string[]): string {
  const longest = Math.max(2, ...lines.map((l) => /^`{3,}/.exec(l)?.[0].length ?? 0));
  const fence = "`".repeat(longest + 1);
  return `${fence}suggestion\n${lines.map((l) => `${l}\n`).join("")}${fence}`;
}

export async function suggestReviewChanges(id: string): Promise<SuggestedChanges> {
  const { row, worktree, ws } = await reviewWorktree(id);
  const files = await ws.files(worktree, row.headSha).catch(saying);
  const read = await Promise.all(
    files.map(async (file) => {
      if (file.status !== "modified" || file.binary) return { drafts: [], skipped: 1 };
      const [mine, pull, sides] = await Promise.all([
        ws.hunks(worktree, file.path, row.headSha, null),
        ws.hunks(worktree, file.path, `merge-base:${row.baseRef}:${row.headSha}`, row.headSha, 3),
        ws.file(worktree, file.path, row.headSha),
      ]);
      return suggestionsFor(file.path, mine, pull, sides.oldContent.split("\n"));
    }),
  );
  const drafts = read.flatMap((r) => r.drafts);
  const comments = threadReview(reviewKey(id), "github");
  await drafts.reduce<Promise<unknown>>(
    (previous, draft) => previous.then(() => comments.addDraft(draft)),
    Promise.resolve(),
  );
  const skipped = read.reduce((sum, r) => sum + r.skipped, 0);
  return { added: drafts.length, skipped };
}

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

export async function reviewTerminal(id: string): Promise<ReviewTerminal> {
  const { worktree } = await reviewWorktree(id);
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
