import {
  preferredMergeMethod,
  WORKFLOW_KINDS,
  type WorkflowName,
} from "../../../shared/code-status";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import type { MergeMethod } from "@tiny-agents/github";
import type { TurnOutcome } from "@tiny-agents/code/server";
import type { CodePullRow, CodeProjectRow, CodeThreadRow } from "../../db";
import type { ThreadPullsView } from "../../../shared/api/code";
import { actionableItems, stateHash } from "./code.autofix";
import { cancelPendingJob } from "../pending-jobs";
import { checkpointTurn } from "./code.checkpoints";
import { codeGitHub } from "./code.github";
import { codeHub } from "./code.hub";
import { pullTitle } from "./code.naming";
import { finishPass, startPass } from "./code.passes";
import { projectSettings, projectThread, projectView, repoOf } from "./code.projects";
import {
  appCommentIds,
  cacheSnapshot,
  deletePull,
  findPull,
  getPull,
  insertPull,
  moveLoop,
  openPullOf,
  pullsOf,
  runningPass,
  updatePull,
} from "./code.pulls.store";
import {
  armReconcile,
  autofixSettings,
  githubMessage,
  ownerLoginOf,
  reconcileNow,
  tellProjectChat,
  YOLO_LOOK_MS,
} from "./code.pulls.reconcile";
import { pullView } from "./code.pulls.view";

async function requireProjectThread(threadId: string) {
  const found = await projectThread(threadId);
  if (!found) throw Boom.badRequest("This thread is not in a project.");
  return found;
}

async function openPullContext(threadId: string) {
  const { project } = await requireProjectThread(threadId);
  const open = await openPullOf(threadId);
  if (!open) throw Boom.notFound("The thread has no open pull request.");
  return {
    project,
    open,
    repo: repoOf(project),
    github: () => codeGitHub().client(project),
  };
}

function logUnrefreshed(error: unknown, threadId: string): undefined {
  logger.warn({ error, threadId }, "Code: could not refresh the thread's pull request from GitHub");
}

function logUnknownOwner(error: unknown, threadId: string): undefined {
  logger.warn({ error, threadId }, "Code: could not tell who owns the thread's pull request");
}

function pullBody(commits: Array<{ sha: string; subject: string }>): string {
  const list = commits
    .slice(0, 30)
    .map((c) => `- ${c.subject} (${c.sha.slice(0, 7)})`)
    .join("\n");
  return `${list}\n\nOpened from tiny-agents Code.`;
}

export async function publish(
  threadId: string,
  input: { title?: string; body?: string; commit?: boolean } = {},
): Promise<CodePullRow> {
  const { thread, project } = await requireProjectThread(threadId);
  if (!thread.worktree || !thread.branch) {
    throw Boom.badRequest("The thread has no worktree; unarchive it first.");
  }
  const services = codeGitHub();
  const ws = await services.workspace(project);
  const repo = repoOf(project);
  if (input.commit && (await ws.uncommitted(thread.worktree)).length > 0) {
    const login = await (
      await services.client(project)
    )
      .viewer()
      .then((viewer) => viewer.login)
      .catch((error: unknown) => {
        throw Boom.badGateway(
          `GitHub did not say who you are, so nothing was committed: ${githubMessage(error)}`,
        );
      });
    await ws
      .commitAll(thread.worktree, thread.title?.trim() || `Changes on ${thread.branch}`, {
        name: login,
        email: `${login}@users.noreply.github.com`,
      })
      .catch((error: unknown) => {
        throw Boom.conflict(githubMessage(error));
      });
  }
  const commits = await ws.commitsAhead(thread.worktree, project.baseBranch);
  const open = await openPullOf(threadId);
  if (commits.length === 0 && !open) {
    throw Boom.badRequest(
      `Nothing to publish: no commits ahead of ${project.baseBranch}. Commit first.`,
    );
  }
  await ws.push(thread.worktree, repo, thread.branch).catch((error: unknown) => {
    throw Boom.conflict(githubMessage(error));
  });
  if (open) {
    await reconcileNow(open.id);
    return (await getPull(open.id)) ?? open;
  }
  const github = await services.client(project);
  const existing = await github.openPullForBranch(repo, thread.branch);
  const threadTitle =
    thread.title || (await codeHub()?.list())?.find((r) => r.id === threadId)?.title || null;
  const title =
    input.title?.trim() ||
    (existing
      ? ""
      : await pullTitle({
          thread: threadTitle,
          commits: commits.map((c) => c.subject),
        })) ||
    threadTitle ||
    commits.at(-1)?.subject ||
    thread.branch;
  const created =
    existing ??
    (await github
      .createPull(repo, {
        head: thread.branch,
        base: project.baseBranch,
        title,
        body: input.body?.trim() || pullBody(commits),
        draft: projectSettings(project.settings).draftPulls,
      })
      .catch((error: unknown) => {
        throw Boom.badRequest(`GitHub refused the pull request: ${githubMessage(error)}`);
      }));
  const row = await insertPull({
    threadId,
    projectId: project.id,
    number: created.number,
    url: created.url,
    title,
    headRef: thread.branch,
    baseRef: project.baseBranch,
    autofix: projectSettings(project.settings).autofix.onByDefault,
  });
  await tellProjectChat(row, "opened");
  await reconcileNow(row.id);
  await armReconcile(row.id, 60_000);
  return (await getPull(row.id)) ?? row;
}

export async function linkPull(threadId: string, number: number): Promise<CodePullRow> {
  const { project } = await requireProjectThread(threadId);
  const taken = await findPull(project.id, number);
  if (taken) {
    if (taken.threadId === threadId) return taken;
    throw Boom.conflict(`#${number} is already linked to another thread.`);
  }
  if (await openPullOf(threadId)) {
    throw Boom.conflict("The thread already has an open pull request; unlink it first.");
  }
  const github = await codeGitHub().client(project);
  const snapshot = await github.snapshot(repoOf(project), number).catch((error: unknown) => {
    throw Boom.badRequest(`Cannot read #${number}: ${githubMessage(error)}`);
  });
  if (snapshot.state !== "open") throw Boom.badRequest(`#${number} is ${snapshot.state}.`);
  const row = await insertPull({
    threadId,
    projectId: project.id,
    number,
    url: snapshot.url,
    title: snapshot.title,
    headRef: snapshot.headRef,
    baseRef: snapshot.baseRef,
    autofix: false,
  });
  await cacheSnapshot(row.id, snapshot);
  await armReconcile(row.id, 60_000);
  return (await getPull(row.id)) ?? row;
}

export async function unlinkPull(threadId: string): Promise<void> {
  const open = await openPullOf(threadId);
  if (!open) throw Boom.notFound("The thread has no open pull request.");
  if (open.pendingJobId) await cancelPendingJob(open.pendingJobId);
  await deletePull(open.id);
}

async function branchesOf(thread: CodeThreadRow, project: CodeProjectRow): Promise<string[]> {
  const current = thread.worktree
    ? await (
        await codeGitHub().workspace(project)
      )
        .currentBranch(thread.worktree)
        .catch(countUnknownWhenGitFails)
    : null;
  return [...new Set([current, thread.branch])].filter(
    (name): name is string => Boolean(name) && name !== project.baseBranch,
  );
}

async function linkByBranch(threadId: string): Promise<CodePullRow | undefined> {
  const found = await projectThread(threadId);
  if (!found || (await openPullOf(threadId))) return undefined;
  const { project, thread } = found;
  const github = await codeGitHub().client(project);
  for (const branch of await branchesOf(thread, project)) {
    const pr = await github.openPullForBranch(repoOf(project), branch);
    if (!pr || (await findPull(project.id, pr.number))) continue;
    const row = await insertPull({
      threadId,
      projectId: project.id,
      number: pr.number,
      url: pr.url,
      title: "",
      headRef: branch,
      baseRef: project.baseBranch,
      autofix: projectSettings(project.settings).autofix.onByDefault,
    });
    await tellProjectChat(row, "opened");
    await reconcileNow(row.id);
    await armReconcile(row.id, 60_000);
    return row;
  }
  return undefined;
}

export async function setAutofix(threadId: string, enabled: boolean): Promise<void> {
  const open = await openPullOf(threadId);
  if (!open) throw Boom.notFound("The thread has no open pull request.");
  if (enabled) {
    await updatePull(open.id, {
      autofix: true,
      ownerInputAt: new Date(),
      passesWithoutOwner: 0,
    });
    await moveLoop(open.id, "watching", {
      headSha: open.headSha,
      autofix: true,
    });
    await reconcileNow(open.id);
    await armReconcile(open.id, 60_000, open.pendingJobId);
  } else {
    await moveLoop(open.id, "off", { reason: "Switched off.", autofix: false });
    await updatePull(open.id, { autofix: false });
  }
}

export async function noteOwnerInput(threadId: string): Promise<void> {
  const open = await openPullOf(threadId);
  if (!open) return;
  await updatePull(open.id, {
    ownerInputAt: new Date(),
    passesWithoutOwner: 0,
  });
  if (open.loopStatus === "needs_input" || open.loopStatus === "paused") {
    await moveLoop(open.id, "watching", {
      headSha: open.headSha,
      from: ["needs_input", "paused"],
    });
  }
}

export async function mergePull(threadId: string, picked?: MergeMethod): Promise<void> {
  const { open, repo, github } = await openPullContext(threadId);
  const client = await github();
  const method =
    picked ?? preferredMergeMethod((await client.snapshot(repo, open.number)).mergeMethods);
  if (!method) throw Boom.conflict(`${repo.owner}/${repo.name} allows no merge method.`);
  await client.merge(repo, open.number, method).catch((error: unknown) => {
    throw Boom.conflict(`GitHub did not merge #${open.number}: ${githubMessage(error)}`);
  });
  await reconcileNow(open.id);
}

export async function armYoloMerge(threadId: string, method: MergeMethod): Promise<void> {
  const { project, open, repo, github } = await openPullContext(threadId);
  const snapshot = await (await github()).snapshot(repo, open.number);
  if (!snapshot.mergeMethods.includes(method)) {
    throw Boom.conflict(`${repo.owner}/${repo.name} does not allow ${method} merges.`);
  }
  await updatePull(open.id, { yoloMethod: method, yoloWaiting: null });
  logger.info({ pull: open.id, project: project.id, method }, "Code: YOLO Merge armed");
  await reconcileNow(open.id);
  await armReconcile(open.id, YOLO_LOOK_MS);
}

export async function cancelYoloMerge(threadId: string): Promise<void> {
  const { open } = await openPullContext(threadId);
  await updatePull(open.id, { yoloMethod: null, yoloWaiting: null });
}

export async function setPullDraft(threadId: string, draft: boolean): Promise<void> {
  const context = await openPullContext(threadId);
  const { open } = context;
  const github = await context.github();
  const snapshot = await github.snapshot(context.repo, open.number);
  if (snapshot.draft === draft) {
    throw Boom.conflict(`#${open.number} is already ${draft ? "a draft" : "ready for review"}.`);
  }
  const change = draft ? github.convertToDraft(snapshot.id) : github.markReady(snapshot.id);
  await change.catch((error: unknown) => {
    throw Boom.conflict(
      `GitHub kept #${open.number} ${draft ? "ready for review" : "a draft"}: ${githubMessage(error)}`,
    );
  });
  await reconcileNow(open.id);
}

export async function editPull(
  threadId: string,
  change: { title?: string; body?: string },
): Promise<void> {
  const { open, repo, github } = await openPullContext(threadId);
  await (await github()).updatePull(repo, open.number, change).catch((error: unknown) => {
    throw Boom.conflict(`GitHub did not update #${open.number}: ${githubMessage(error)}`);
  });
  await reconcileNow(open.id);
}

export async function manualPass(
  threadId: string,
  workflow: WorkflowName,
): Promise<{ started: boolean; reason?: string }> {
  const context = await openPullContext(threadId);
  const { project, open } = context;
  if (await runningPass(open.id)) return { started: false, reason: "A pass is already running." };
  const github = await context.github();
  const snapshot = await github.snapshot(context.repo, open.number);
  const row = await cacheSnapshot(open.id, snapshot);
  if (!row) throw Boom.notFound("The thread's pull request was unlinked.");
  const items = actionableItems({
    snapshot,
    appCommentIds: await appCommentIds(open.id),
    ownerLogin: await ownerLoginOf(project, github),
    settings: {
      ...autofixSettings(project.settings),
      triggers: {
        checks: true,
        reviews: true,
        conflicts: true,
      },
    },
  });
  const wanted = items.filter((item) => WORKFLOW_KINDS[workflow].includes(item.kind));
  if (wanted.length === 0) return { started: false, reason: NOTHING_TO_DO[workflow] };
  const hash = stateHash(snapshot.headSha, [`manual:${Date.now()}`, ...wanted.map((i) => i.id)]);
  const pass = await startPass(row, "manual", wanted, hash);
  return pass ? { started: true } : { started: false, reason: "The pass could not start." };
}

const NOTHING_TO_DO: Record<WorkflowName, string> = {
  fix_ci: "No check is failing.",
  address_comments: "No review comment is waiting.",
  resolve_conflicts: "The branch has no conflict with its base.",
};

export async function onTurnEnded(threadId: string, outcome: TurnOutcome): Promise<void> {
  if (outcome.working) return;
  await checkpointTurn(threadId).catch((error: unknown) =>
    logger.warn({ error, threadId }, "Code: could not checkpoint the turn"),
  );
  const open = await openPullOf(threadId);
  if (!open) {
    if (await projectThread(threadId)) {
      await linkByBranch(threadId).catch((error: unknown) => logUnrefreshed(error, threadId));
    }
    return;
  }
  const pass = await runningPass(open.id);
  if (pass?.status === "running") await finishPass(pass, outcome);
}

function countUnknownWhenGitFails(error: unknown): null {
  logger.warn({ error }, "Code: git could not read a thread's worktree");
  return null;
}

function landingUnknownWhenGitFails(error: unknown): null {
  logger.warn({ error }, "Code: git could not tell whether a thread's work landed");
  return null;
}

export async function pushBase(threadId: string): Promise<void> {
  const { thread, project } = await requireProjectThread(threadId);
  if (!thread.worktree) throw Boom.badRequest("The thread has no worktree; unarchive it first.");
  const ws = await codeGitHub().workspace(project);
  await ws
    .pushBase(thread.worktree, repoOf(project), project.baseBranch)
    .catch((error: unknown) => {
      throw Boom.conflict(githubMessage(error));
    });
}

export async function threadPulls(threadId: string, fresh = true): Promise<ThreadPullsView> {
  const found = await projectThread(threadId);
  if (!found) {
    return {
      project: null,
      branch: null,
      active: null,
      earlier: [],
      ahead: null,
      uncommitted: null,
      landed: null,
    };
  }
  const { project, thread } = found;
  if (fresh) {
    const open = await openPullOf(threadId);
    const refreshed = open ? reconcileNow(open.id) : linkByBranch(threadId);
    await refreshed.catch((error: unknown) => logUnrefreshed(error, threadId));
  }
  const rows = await pullsOf(threadId);
  const active = rows.find((r) => r.state === "open") ?? null;
  let ahead: number | null = null;
  let uncommitted: number | null = null;
  let landed: ThreadPullsView["landed"] = null;
  if (thread.worktree) {
    const worktree = thread.worktree;
    const ws = await codeGitHub().workspace(project);
    [ahead, uncommitted] = await Promise.all([
      ws
        .commitsAhead(worktree, project.baseBranch)
        .then((c) => c.length)
        .catch(countUnknownWhenGitFails),
      ws
        .uncommitted(worktree)
        .then((files) => files.length)
        .catch(countUnknownWhenGitFails),
    ]);
    const head = await ws.headSha(worktree).catch(countUnknownWhenGitFails);
    const lastMerged = active ? undefined : rows.find((r) => r.state === "merged");
    const worked = Boolean(head && thread.baseSha && head !== thread.baseSha);
    if (!active && worked && ahead === 0) landed = "github";
    else if (!active && worked && !lastMerged && ahead !== null) {
      landed = await ws.landedIn(worktree, project.baseBranch).catch(landingUnknownWhenGitFails);
    }
    if (landed === "github") ahead = 0;
    else if (lastMerged?.headSha && ahead !== null) {
      ahead = await ws.commitsSince(worktree, lastMerged.headSha).catch(countUnknownWhenGitFails);
    }
  }
  const owner = active
    ? await codeGitHub()
        .client(project)
        .then(async (github) => ({ login: await ownerLoginOf(project, github) }))
        .catch((error: unknown) => logUnknownOwner(error, threadId))
    : undefined;
  const settings = autofixSettings(project.settings);
  return {
    project: projectView(project),
    branch: thread.branch,
    active: active ? await pullView(active, owner, settings) : null,
    earlier: rows
      .filter((r) => r !== active)
      .map((r) => ({
        number: r.number,
        url: r.url,
        title: r.title,
        state: r.state,
      })),
    ahead,
    uncommitted,
    landed,
  };
}
