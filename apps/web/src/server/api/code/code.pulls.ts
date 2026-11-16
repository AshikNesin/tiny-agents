/**
 * Pull requests linked to Code threads, and the reconciler that keeps them
 * current and runs Auto-fix (issue #297 §7.3 to §7.6, §9).
 *
 * The reconciler never trusts an event: it fetches a fresh snapshot, caches
 * it, and acts on `decide(snapshot, …)`. Polling is a chained delayed job
 * per open PR (`code-pr-reconcile`), each run queueing its successor at the
 * interval `nextLookMs` gives; the chain's current link is stored on the
 * row, so a duplicate run never forks it, and boot re-arms any chain whose
 * link is gone. Opening the PR tab reconciles at once.
 *
 * The app publishes (§7.3): it pushes, opens the draft PR and records the
 * link the moment it exists. A PR someone else opened for the thread's
 * branch (the agent, with `gh`) is linked by branch match when the tab
 * opens or a turn ends.
 */
import { eq, inArray } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { notificationService } from "@groot/core/notification/notification.service";
import { addJob, cancelJob } from "@groot/jobs/server/queue";
import { registerJobHandler } from "@groot/jobs/server/worker";
import {
  GitHubError,
  type GitHubClient,
  type MergeMethod,
  type PullSnapshot,
} from "@tiny-agents/github";
import type { TurnOutcome } from "@tiny-agents/code/server";
import { codeThreads, db, jobs, type CodePullRow } from "../../db";
import type { PullView, ThreadPullsView } from "../../../shared/api/code";
import { codePullUpdate, type CodePullKind } from "../notifications/notifications.events";
import {
  actionableItems,
  DEFAULT_AUTOFIX,
  decide,
  isAppComment,
  isTrusted,
  nextLookMs,
  stalledChecks,
  stateHash,
  type AutofixSettings,
} from "./code.autofix";
import { checkpointTurn } from "./code.checkpoints";
import { codeGitHub } from "./code.github";
import { codeHub } from "./code.hub";
import { finishPass, startPass, timeOutPass } from "./code.passes";
import {
  onProjectThreadArchived,
  projectSettings,
  projectThread,
  projectView,
  repoOf,
} from "./code.projects";
import {
  appCommentIds,
  cacheSnapshot,
  cachedSnapshot,
  deletePull,
  findPull,
  getPull,
  insertPull,
  moveLoop,
  openPullOf,
  openPulls,
  passRecord,
  passesOf,
  pullsOf,
  runningPass,
  setPendingJob,
  updatePull,
} from "./code.pulls.store";

export const RECONCILE_JOB = "code-pr-reconcile";

async function requireProjectThread(threadId: string) {
  const found = await projectThread(threadId);
  if (!found) throw Boom.badRequest("This thread is not in a project.");
  return found;
}

function autofixSettings(raw: string): AutofixSettings {
  const s = projectSettings(raw).autofix;
  return {
    ...DEFAULT_AUTOFIX,
    triggers: s.triggers,
    trustedBots: s.trustedBots,
    hourlyLimit: s.hourlyLimit,
    noOwnerLimit: s.noOwnerLimit,
    passMinutes: s.passMinutes,
    finalCheck: s.finalCheck,
  };
}

function notify(pull: CodePullRow, kind: CodePullKind, detail?: string) {
  if ((codeHub()?.viewers(pull.threadId) ?? 0) > 0) return;
  notificationService.notify(codePullUpdate(pull, kind, detail));
}

const githubMessage = (error: unknown) =>
  error instanceof GitHubError || error instanceof Error ? error.message : String(error);

// --- publish and link ---------------------------------------------------------------------

/** The PR body the app writes: the commits, and where it came from. */
function pullBody(commits: Array<{ sha: string; subject: string }>): string {
  const list = commits
    .slice(0, 30)
    .map((c) => `- ${c.subject} (${c.sha.slice(0, 7)})`)
    .join("\n");
  return `${list}\n\nOpened from tiny-agents Code.`;
}

/**
 * Publish (§7.3): push the branch and open a draft PR, or, when the thread
 * already has an open one, push its new commits. A manual publish is not
 * held to the protected-path rule; a pass is.
 */
export async function publish(
  threadId: string,
  input: { title?: string; body?: string } = {},
): Promise<CodePullRow> {
  const { thread, project } = await requireProjectThread(threadId);
  if (!thread.worktree || !thread.branch) {
    throw Boom.badRequest("The thread has no worktree; unarchive it first.");
  }
  const services = codeGitHub();
  const ws = await services.workspace(project);
  const repo = repoOf(project);
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
  const created =
    existing ??
    (await github
      .createPull(repo, {
        head: thread.branch,
        base: project.baseBranch,
        title: input.title?.trim() || thread.title || commits.at(-1)?.subject || thread.branch,
        body: input.body?.trim() || pullBody(commits),
        draft: true,
      })
      .catch((error: unknown) => {
        throw Boom.badRequest(`GitHub refused the pull request: ${githubMessage(error)}`);
      }));
  const row = await insertPull({
    threadId,
    projectId: project.id,
    number: created.number,
    url: created.url,
    title: input.title?.trim() || thread.title || "",
    headRef: thread.branch,
    baseRef: project.baseBranch,
    autofix: projectSettings(project.settings).autofix.onByDefault,
    autoMerge: projectSettings(project.settings).autofix.autoMergeByDefault,
  });
  await reconcileNow(row.id);
  await armReconcile(row.id, 60_000);
  return (await getPull(row.id)) ?? row;
}

/** Link an existing PR to the thread (§7.5). A PR belongs to one thread. */
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

/** Unlink: the row goes, and with it Auto-fix for that PR. */
export async function unlinkPull(threadId: string): Promise<void> {
  const open = await openPullOf(threadId);
  if (!open) throw Boom.notFound("The thread has no open pull request.");
  if (open.pendingJobId) await cancelJob(open.pendingJobId).catch(() => undefined);
  await deletePull(open.id);
}

/**
 * A project thread with no open PR: link the open PR whose head is its
 * branch, whoever opened it (the agent, with `gh`). Answers the link.
 */
async function linkByBranch(threadId: string): Promise<CodePullRow | undefined> {
  const found = await projectThread(threadId);
  if (!found?.thread.branch || (await openPullOf(threadId))) return undefined;
  const github = await codeGitHub().client(found.project);
  const pr = await github.openPullForBranch(repoOf(found.project), found.thread.branch);
  if (!pr || (await findPull(found.project.id, pr.number))) return undefined;
  const row = await insertPull({
    threadId,
    projectId: found.project.id,
    number: pr.number,
    url: pr.url,
    title: "",
    headRef: found.thread.branch,
    baseRef: found.project.baseBranch,
    autofix: projectSettings(found.project.settings).autofix.onByDefault,
    autoMerge: projectSettings(found.project.settings).autofix.autoMergeByDefault,
  });
  await reconcileNow(row.id);
  await armReconcile(row.id, 60_000);
  return row;
}

// --- owner controls -----------------------------------------------------------------------

export async function setAutofix(threadId: string, enabled: boolean): Promise<void> {
  const open = await openPullOf(threadId);
  if (!open) throw Boom.notFound("The thread has no open pull request.");
  if (enabled) {
    await updatePull(open.id, { autofix: true, ownerInputAt: new Date(), passesWithoutOwner: 0 });
    await moveLoop(open.id, "watching", { headSha: open.headSha, autofix: true });
    await reconcileNow(open.id);
    await armReconcile(open.id, 60_000, open.pendingJobId);
  } else {
    await moveLoop(open.id, "off", { reason: "Switched off.", autofix: false });
    await updatePull(open.id, { autofix: false });
  }
}

/** The owner wrote in the thread: a waiting or paused loop may go on, and the no-owner count resets. */
export async function noteOwnerInput(threadId: string): Promise<void> {
  const open = await openPullOf(threadId);
  if (!open) return;
  await updatePull(open.id, { ownerInputAt: new Date(), passesWithoutOwner: 0 });
  // needs_input and paused wait for exactly this.
  if (open.loopStatus === "needs_input" || open.loopStatus === "paused") {
    await moveLoop(open.id, "watching", { headSha: open.headSha, from: ["needs_input", "paused"] });
  }
}

export async function mergePull(threadId: string, method: MergeMethod): Promise<void> {
  const { project } = await requireProjectThread(threadId);
  const open = await openPullOf(threadId);
  if (!open) throw Boom.notFound("The thread has no open pull request.");
  const github = await codeGitHub().client(project);
  await github.merge(repoOf(project), open.number, method).catch((error: unknown) => {
    throw Boom.conflict(`GitHub did not merge #${open.number}: ${githubMessage(error)}`);
  });
  await reconcileNow(open.id);
}

/** The owner edits the open pull request's title or description, on GitHub. */
export async function editPull(
  threadId: string,
  change: { title?: string; body?: string },
): Promise<void> {
  const { project } = await requireProjectThread(threadId);
  const open = await openPullOf(threadId);
  if (!open) throw Boom.notFound("The thread has no open pull request.");
  const github = await codeGitHub().client(project);
  await github.updatePull(repoOf(project), open.number, change).catch((error: unknown) => {
    throw Boom.conflict(`GitHub did not update #${open.number}: ${githubMessage(error)}`);
  });
  await reconcileNow(open.id);
}

/** Fix CI (§7.5): one pass the owner asked for, on whatever is open now. */
export async function manualPass(threadId: string): Promise<{ started: boolean; reason?: string }> {
  const { project } = await requireProjectThread(threadId);
  const open = await openPullOf(threadId);
  if (!open) throw Boom.notFound("The thread has no open pull request.");
  if (await runningPass(open.id)) return { started: false, reason: "A pass is already running." };
  const github = await codeGitHub().client(project);
  const snapshot = await github.snapshot(repoOf(project), open.number);
  const row = await cacheSnapshot(open.id, snapshot);
  const items = actionableItems({
    snapshot,
    appCommentIds: await appCommentIds(open.id),
    ownerLogin: (await github.viewer().catch(() => undefined))?.login ?? null,
    settings: {
      ...autofixSettings(project.settings),
      triggers: { checks: true, reviews: true, conflicts: true, mergeQueue: true },
    },
  });
  if (items.length === 0) return { started: false, reason: "Nothing is failing or open." };
  const hash = stateHash(snapshot.headSha, [`manual:${Date.now()}`, ...items.map((i) => i.id)]);
  const pass = await startPass(row, "manual", items, hash);
  return pass ? { started: true } : { started: false, reason: "The pass could not start." };
}

// --- reconcile ----------------------------------------------------------------------------

/** Run one reconcile now (serialized per PR in this process). Answers the next look in ms, or null. */
async function reconcileNow(pullId: string): Promise<number | null> {
  const hub = codeHub();
  const work = () => reconcile(pullId);
  return hub ? hub.serial(`code-pr:${pullId}`, work) : work();
}

async function reconcile(pullId: string, now = Date.now()): Promise<number | null> {
  const before = await getPull(pullId);
  if (!before || before.state !== "open") return null;
  const found = await projectThread(before.threadId);
  if (!found) return null;
  const { project } = found;
  const services = codeGitHub();
  const github = await services.client(project);
  let snapshot: PullSnapshot;
  try {
    snapshot = await github.snapshot(repoOf(project), before.number);
  } catch (error) {
    logger.warn({ error, pull: pullId }, "Code: could not read a linked pull request");
    return 5 * 60_000;
  }
  let pull = await cacheSnapshot(pullId, snapshot);
  const settings = autofixSettings(project.settings);

  if (snapshot.state === "merged") {
    await moveLoop(pull.id, "merged");
    notify(pull, "merged");
    if (projectSettings(project.settings).archiveOnMerge) await archiveThread(pull.threadId);
    return null;
  }
  if (snapshot.state === "closed") {
    await moveLoop(pull.id, "off", { reason: "The pull request was closed.", autofix: false });
    return null;
  }

  const stalled = stalledChecks(snapshot, now, settings.stallHours);
  if (stalled.length && pull.stalledNotifiedSha !== snapshot.headSha) {
    await updatePull(pull.id, { stalledNotifiedSha: snapshot.headSha });
    notify(pull, "stalled", `${stalled.map((c) => c.name).join(", ")} has been pending for hours.`);
  }

  // A pass whose turn ended while nothing was listening: finish it now (owed finish).
  const running = await runningPass(pull.id);
  if (running?.status === "running") {
    const target = codeHub()?.resolve(pull.threadId);
    const outcome = await target?.instance.outcome(target.nativeId).catch(() => undefined);
    if (
      outcome &&
      !outcome.working &&
      (outcome.endedAt ?? 0) >= (running.startedAt?.getTime() ?? 0)
    ) {
      await finishPass(running, outcome);
      pull = (await getPull(pull.id)) ?? pull;
    }
  }

  // Under the App the client acts as the App's bot, not the owner.
  const ownerLogin =
    project.transport === "app"
      ? null
      : ((await github.viewer().catch(() => undefined))?.login ?? null);
  const spend = await threadSpend(pull.threadId, found.thread.spendLimitUsd);
  let lastPushAt: number | null = null;
  for (let step = 0; step < 3; step += 1) {
    const passes = await passesOf(pull.id);
    lastPushAt = passes.find((p) => p.pushedSha)?.finishedAt?.getTime() ?? null;
    const decision = decide({
      snapshot,
      loop: {
        enabled: pull.autofix,
        status: pull.loopStatus,
        changedAt: pull.loopChangedAt?.getTime() ?? null,
        headAtChange: pull.loopHeadSha,
        passesWithoutOwner: pull.passesWithoutOwner,
        ownerInputAt: pull.ownerInputAt?.getTime() ?? null,
      },
      passes: passes.map(passRecord),
      appCommentIds: await appCommentIds(pull.id),
      ownerLogin,
      settings,
      now,
      spend,
    });
    // A green PR that needs acting on (a new failure, a limit) is watched again first:
    // the machine moves green only to watching.
    if (pull.loopStatus === "green" && decision.kind !== "none" && decision.kind !== "green") {
      await moveLoop(pull.id, "watching", { headSha: snapshot.headSha });
      pull = (await getPull(pull.id)) ?? pull;
    }
    if (decision.kind === "resume") {
      await moveLoop(pull.id, "watching", { headSha: snapshot.headSha });
      pull = (await getPull(pull.id)) ?? pull;
      continue;
    }
    if (decision.kind === "wait") {
      return Math.max(5_000, decision.until - now);
    }
    if (decision.kind === "pass") {
      await startPass(pull, decision.trigger, decision.items, decision.hash);
    } else if (decision.kind === "green") {
      if (await moveLoop(pull.id, "green", { headSha: snapshot.headSha })) notify(pull, "green");
    } else if (decision.kind === "timeout") {
      const pass = passes.find((p) => p.id === decision.passId);
      if (pass) await timeOutPass(pass);
    } else if (decision.kind === "needs_input") {
      if (
        await moveLoop(pull.id, "needs_input", {
          reason: decision.reason,
          headSha: snapshot.headSha,
        })
      ) {
        notify(pull, "needs_input", decision.reason);
      }
    } else if (decision.kind === "pause") {
      if (
        await moveLoop(pull.id, "paused", { reason: decision.reason, headSha: snapshot.headSha })
      ) {
        notify(pull, "needs_input", decision.reason);
      }
    } else if (decision.kind === "off") {
      if (await moveLoop(pull.id, "off", { reason: decision.reason, autofix: false })) {
        notify(pull, "off", decision.reason);
      }
    } else if (decision.kind === "none" && !pull.autofix) {
      // Once, when the checks of a head finish failed (not on every look).
      const prev = cachedSnapshot(before);
      const justFinished =
        !prev ||
        prev.headSha !== snapshot.headSha ||
        prev.checks.some((c) => c.state === "pending");
      const failed = snapshot.checks.filter((c) => c.state === "failure");
      if (justFinished && failed.length && snapshot.checks.every((c) => c.state !== "pending")) {
        notify(pull, "checks_failed", failed.map((c) => c.name).join(", "));
      }
    }
    break;
  }
  const latest = (await getPull(pull.id)) ?? pull;
  await applyAutoMerge(latest, snapshot, github);
  return nextLookMs(snapshot, latest.loopStatus, lastPushAt, now, settings.stallHours);
}

/** Archive the thread whose PR merged (archive on merge, §7.6). */
async function archiveThread(threadId: string): Promise<void> {
  const target = codeHub()?.resolve(threadId);
  try {
    if (target?.instance.archive && target.instance.capabilities().threads.archive) {
      await target.instance.archive(target.nativeId, true);
      void codeHub()?.refresh(target.instance.id);
    }
    await onProjectThreadArchived(threadId, true);
  } catch (error) {
    logger.warn({ error, threadId }, "Code: could not archive a merged thread");
  }
}

/** A project thread was archived: Auto-fix goes off for its open PR, which stays open (§7.6). */
export async function onThreadArchived(threadId: string, archived: boolean): Promise<void> {
  if (archived) {
    const open = await openPullOf(threadId);
    if (open)
      await moveLoop(open.id, "off", { reason: "The thread was archived.", autofix: false });
  }
  await onProjectThreadArchived(threadId, archived);
}

// --- the chain ----------------------------------------------------------------------------

/**
 * Queue the next reconcile of a PR in `delayMs`, as the chain's new link:
 * only from `expected` (the run that is the current link) when given, so a
 * duplicate run never forks the chain. A job that lost is cancelled.
 */
export async function armReconcile(
  pullId: string,
  delayMs: number,
  expected?: string | null,
): Promise<string | undefined> {
  const runAt = new Date(Date.now() + delayMs);
  // No singleton key: the row's compare-and-set is what keeps one link.
  const jobId = await addJob(RECONCILE_JOB, { pullId }, { runAt, retryLimit: 1 });
  if (await setPendingJob(pullId, jobId, expected)) {
    if (expected === undefined) {
      // Replaced a link unconditionally: the old one would fork the chain.
      const rows = await db
        .select()
        .from(jobs)
        .where(inArray(jobs.state, ["created"]));
      for (const job of rows) {
        const data = job.data as { pullId?: string } | null;
        if (job.id !== jobId && job.name === RECONCILE_JOB && data?.pullId === pullId) {
          await cancelJob(job.id).catch(() => undefined);
        }
      }
    }
    return jobId;
  }
  await cancelJob(jobId).catch(() => undefined);
  return undefined;
}

export function registerCodeJobs(): void {
  registerJobHandler<{ pullId: string }>(RECONCILE_JOB, async (job) => {
    const next = await reconcileNow(job.data.pullId);
    if (next === null) {
      await setPendingJob(job.data.pullId, null, job.id);
      return { next: null };
    }
    await armReconcile(job.data.pullId, next, job.id);
    return { next };
  });
}

/** Boot: every open linked PR whose chain has no live link gets one. */
export async function rearmReconcilers(): Promise<number> {
  let armed = 0;
  for (const pull of await openPulls()) {
    const live = pull.pendingJobId
      ? await db.query.jobs.findFirst({ where: eq(jobs.id, pull.pendingJobId) })
      : undefined;
    if (live && (live.state === "created" || live.state === "active")) continue;
    if (await armReconcile(pull.id, 5_000, pull.pendingJobId)) armed += 1;
  }
  return armed;
}

/** What the thread has cost and its limit, read only when a limit is set. */
async function threadSpend(
  threadId: string,
  limitUsd: number | null,
): Promise<{ usd: number | null; limitUsd: number | null }> {
  if (limitUsd === null) return { usd: null, limitUsd: null };
  const target = codeHub()?.resolve(threadId);
  const snapshot = await target?.instance.getThread(target.nativeId).catch(() => undefined);
  // A harness that reports no cost reports 0: unknown, never "spent nothing".
  return { usd: snapshot && snapshot.costUsd > 0 ? snapshot.costUsd : null, limitUsd };
}

/** The merge method auto-merge asks for: the repository's first of squash, merge, rebase. */
function autoMergeMethod(snapshot: PullSnapshot): MergeMethod | undefined {
  return (["squash", "merge", "rebase"] as const).find((m) => snapshot.mergeMethods.includes(m));
}

/**
 * Auto-merge (phase 6): with the PR's switch on and no pass running, turn
 * on GitHub's native auto-merge (a draft is marked ready first), so branch
 * protection and required reviews are GitHub's to enforce.
 */
async function applyAutoMerge(
  pull: CodePullRow,
  snapshot: PullSnapshot,
  github: GitHubClient,
): Promise<void> {
  if (!pull.autoMerge || snapshot.state !== "open" || snapshot.autoMerge) return;
  if (pull.loopStatus === "fixing" || (await runningPass(pull.id))) return;
  const method = autoMergeMethod(snapshot);
  if (!method) return;
  try {
    if (snapshot.draft) await github.markReady(snapshot.id);
    await github.enableAutoMerge(snapshot.id, method);
  } catch (error) {
    logger.warn({ error, pull: pull.id }, "Code: could not turn on auto-merge");
  }
}

/** The owner's auto-merge switch for the thread's open PR; off also turns GitHub's off. */
export async function setAutoMerge(threadId: string, enabled: boolean): Promise<void> {
  const { project } = await requireProjectThread(threadId);
  const open = await openPullOf(threadId);
  if (!open) throw Boom.notFound("The thread has no open pull request.");
  await updatePull(open.id, { autoMerge: enabled });
  if (!enabled) {
    const snapshot = cachedSnapshot(open);
    if (snapshot?.autoMerge) {
      const github = await codeGitHub().client(project);
      await github.disableAutoMerge(snapshot.id).catch((error: unknown) => {
        throw Boom.conflict(`GitHub kept auto-merge on: ${githubMessage(error)}`);
      });
    }
  }
  await reconcileNow(open.id);
}

/** The thread's spend limit for Auto-fix passes (USD), or null for none. */
export async function setSpendLimit(threadId: string, limitUsd: number | null): Promise<void> {
  await requireProjectThread(threadId);
  await db.update(codeThreads).set({ spendLimitUsd: limitUsd }).where(eq(codeThreads.id, threadId));
}

/**
 * A thread's turn ended: checkpoint its worktree, finish its running pass,
 * if it has one, or link a PR the agent opened for its branch.
 */
export async function onTurnEnded(threadId: string, outcome: TurnOutcome): Promise<void> {
  if (outcome.working) return;
  await checkpointTurn(threadId).catch((error: unknown) =>
    logger.warn({ error, threadId }, "Code: could not checkpoint the turn"),
  );
  const open = await openPullOf(threadId);
  if (!open) {
    if (await projectThread(threadId)) await linkByBranch(threadId).catch(() => undefined);
    return;
  }
  const pass = await runningPass(open.id);
  if (pass?.status === "running") await finishPass(pass, outcome);
}

// --- views --------------------------------------------------------------------------------

async function pullView(
  row: CodePullRow,
  ownerLogin: string | null,
  settings: AutofixSettings,
): Promise<PullView> {
  const snapshot = cachedSnapshot(row);
  const passes = await passesOf(row.id);
  const ids = await appCommentIds(row.id);
  const ignored: string[] = [];
  if (snapshot) {
    for (const thread of snapshot.threads) {
      const latest = thread.comments.at(-1);
      if (latest && !isAppComment(latest, ids) && !isTrusted(latest.author, ownerLogin, settings)) {
        ignored.push(thread.id);
      }
    }
    for (const review of snapshot.reviews) {
      if (!isTrusted(review.author, ownerLogin, settings)) ignored.push(review.id);
    }
  }
  return {
    id: row.id,
    number: row.number,
    url: row.url,
    title: row.title,
    state: row.state,
    draft: row.draft,
    headRef: row.headRef,
    baseRef: row.baseRef,
    syncedAt: row.syncedAt?.toISOString() ?? null,
    autofix: row.autofix,
    autoMerge: row.autoMerge,
    loop: { status: row.loopStatus, reason: row.loopReason },
    snapshot,
    stalled: snapshot
      ? stalledChecks(snapshot, Date.now(), settings.stallHours).map((c) => c.name)
      : [],
    ignored,
    passes: passes.map((p) => ({
      id: p.id,
      trigger: p.trigger,
      status: p.status,
      outcome: p.outcome,
      detail: p.detail,
      items: passItems(p.items),
      pushedSha: p.pushedSha,
      costUsd: p.costUsd,
      createdAt: p.createdAt.toISOString(),
      finishedAt: p.finishedAt?.toISOString() ?? null,
    })),
  };
}

/** A pass's stored items, for the tab (a malformed row shows none rather than failing the view). */
function passItems(raw: string): Array<{ id: string; title: string }> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter((i): i is { id: string; title?: unknown } => typeof i?.id === "string")
      .map((i) => ({ id: i.id, title: typeof i.title === "string" ? i.title : i.id }));
  } catch {
    return [];
  }
}

/** The PR tab: reconciles first (unless `fresh` is false), so what it shows is current. */
export async function threadPulls(threadId: string, fresh = true): Promise<ThreadPullsView> {
  const found = await projectThread(threadId);
  if (!found) {
    return {
      project: null,
      branch: null,
      active: null,
      earlier: [],
      ahead: null,
      spend: { usd: null, limitUsd: null },
    };
  }
  const { project, thread } = found;
  if (fresh) {
    const open = await openPullOf(threadId);
    if (open) await reconcileNow(open.id).catch(() => undefined);
    else await linkByBranch(threadId).catch(() => undefined);
  }
  const rows = await pullsOf(threadId);
  const active = rows.find((r) => r.state === "open") ?? null;
  let ahead: number | null = null;
  if (thread.worktree) {
    // The tab still opens when the sandbox is unreachable; it just cannot count.
    ahead = await codeGitHub()
      .workspace(project)
      .then((ws) => ws.commitsAhead(thread.worktree!, project.baseBranch))
      .then((c) => c.length)
      .catch(() => null);
  }
  const ownerLogin = await codeGitHub()
    .client(project)
    .then((c) => c.viewer())
    .then((v) => v.login)
    .catch(() => null);
  const settings = autofixSettings(project.settings);
  return {
    project: projectView(project),
    branch: thread.branch,
    active: active ? await pullView(active, ownerLogin, settings) : null,
    earlier: rows
      .filter((r) => r !== active)
      .map((r) => ({ number: r.number, url: r.url, title: r.title, state: r.state })),
    ahead,
    spend: await threadSpend(threadId, thread.spendLimitUsd ?? 0).then((s) => ({
      usd: s.usd,
      limitUsd: thread.spendLimitUsd,
    })),
  };
}
