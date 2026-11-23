import { WORKFLOW_KINDS, type WorkflowName } from "../../../shared/code-status";
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
import { db, jobs, type CodePullRow, type CodeProjectRow, type CodeThreadRow } from "../../db";
import type { PullView, ThreadPullsView } from "../../../shared/api/code";
import { codePullUpdate, type CodePullKind } from "../notifications/notifications.events";
import {
  actionableItems,
  checksJustFailed,
  DEFAULT_AUTOFIX,
  decide,
  ignoredItems,
  nextLookMs,
  stalledChecks,
  stateHash,
  type AutofixSettings,
} from "./code.autofix";
import { checkpointTurn } from "./code.checkpoints";
import { codeGitHub } from "./code.github";
import { codeHub } from "./code.hub";
import { pullTitle } from "./code.naming";
import { finishPass, startPass, timeOutPass } from "./code.passes";
import { yoloWaiting } from "./code.yolo";
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

function autofixSettings(raw: string): AutofixSettings {
  const s = projectSettings(raw).autofix;
  return {
    ...DEFAULT_AUTOFIX,
    triggers: s.triggers,
    trustedBots: s.trustedBots,
    hourlyLimit: s.hourlyLimit,
    noOwnerLimit: s.noOwnerLimit,
    passMinutes: s.passMinutes,
  };
}

async function ownerLoginOf(
  project: { transport: string },
  github: Pick<GitHubClient, "viewer">,
): Promise<string | null> {
  if (project.transport === "app") return null;
  return (await github.viewer().catch(() => undefined))?.login ?? null;
}

function notify(pull: CodePullRow, kind: CodePullKind, detail?: string) {
  if ((codeHub()?.viewers(pull.threadId) ?? 0) > 0) return;
  notificationService.notify(codePullUpdate(pull, kind, detail));
}

const githubMessage = (error: unknown) =>
  error instanceof GitHubError || error instanceof Error ? error.message : String(error);

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
      .catch(() => "tiny-agents");
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
  if (open.pendingJobId) await cancelJob(open.pendingJobId).catch(() => undefined);
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

export async function mergePull(threadId: string, method: MergeMethod): Promise<void> {
  const { open, repo, github } = await openPullContext(threadId);
  await (await github()).merge(repo, open.number, method).catch((error: unknown) => {
    throw Boom.conflict(`GitHub did not merge #${open.number}: ${githubMessage(error)}`);
  });
  await reconcileNow(open.id);
}

const YOLO_LOOK_MS = 30_000;

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

function keepWaitingWhenAThreadWillNotResolve(error: unknown, threadId: string) {
  logger.warn({ error, threadId }, "Code: YOLO Merge could not resolve a review thread");
}

async function yoloStep(
  pull: CodePullRow,
  snapshot: PullSnapshot,
  github: GitHubClient,
  repo: ReturnType<typeof repoOf>,
): Promise<"merged" | "waiting"> {
  const method = pull.yoloMethod!;
  for (const thread of snapshot.threads.filter((t) => !t.resolved)) {
    await github
      .resolveThread(thread.id)
      .catch((error: unknown) => keepWaitingWhenAThreadWillNotResolve(error, thread.id));
  }
  let draft = snapshot.draft;
  if (draft) {
    try {
      await github.markReady(snapshot.id);
      draft = false;
    } catch (error) {
      logger.warn({ error, pull: pull.id }, "Code: YOLO Merge could not mark the PR ready");
    }
  }
  const waiting = draft
    ? "Waiting for the draft to be marked ready."
    : yoloWaiting(snapshot, method);
  if (waiting) {
    await updatePull(pull.id, { yoloWaiting: waiting });
    return "waiting";
  }
  try {
    await github.merge(repo, pull.number, method);
  } catch (error) {
    await updatePull(pull.id, { yoloWaiting: `Waiting: GitHub said ${githubMessage(error)}` });
    return "waiting";
  }
  await updatePull(pull.id, { yoloMethod: null, yoloWaiting: null });
  notify(pull, "merged");
  return "merged";
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
  if (!pull) return null;
  const settings = autofixSettings(project.settings);

  if (snapshot.state === "open" && pull.yoloMethod) {
    if ((await yoloStep(pull, snapshot, github, repoOf(project))) === "merged") {
      return reconcile(pullId, now);
    }
    pull = (await getPull(pull.id)) ?? pull;
  }

  if (snapshot.state === "merged") {
    await moveLoop(pull.id, "merged");
    notify(pull, "merged");
    if (projectSettings(project.settings).archiveOnMerge) await archiveThread(pull.threadId);
    return null;
  }
  if (snapshot.state === "closed") {
    await moveLoop(pull.id, "off", {
      reason: "The pull request was closed.",
      autofix: false,
    });
    return null;
  }

  const stalled = stalledChecks(snapshot, now, settings.stallHours);
  if (stalled.length && pull.stalledNotifiedSha !== snapshot.headSha) {
    await updatePull(pull.id, { stalledNotifiedSha: snapshot.headSha });
    notify(pull, "stalled", `${stalled.map((c) => c.name).join(", ")} has been pending for hours.`);
  }

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

  const ownerLogin = await ownerLoginOf(project, github);
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
    });
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
        await moveLoop(pull.id, "paused", {
          reason: decision.reason,
          headSha: snapshot.headSha,
        })
      ) {
        notify(pull, "needs_input", decision.reason);
      }
    } else if (decision.kind === "off") {
      if (
        await moveLoop(pull.id, "off", {
          reason: decision.reason,
          autofix: false,
        })
      ) {
        notify(pull, "off", decision.reason);
      }
    } else if (decision.kind === "none" && !pull.autofix) {
      const failed = checksJustFailed(cachedSnapshot(before), snapshot);
      if (failed.length) notify(pull, "checks_failed", failed.join(", "));
    }
    break;
  }
  const latest = (await getPull(pull.id)) ?? pull;
  const next = nextLookMs(snapshot, latest.loopStatus, lastPushAt, now, settings.stallHours);
  return latest.yoloMethod && next !== null ? Math.min(next, YOLO_LOOK_MS) : next;
}

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

export async function onThreadArchived(threadId: string, archived: boolean): Promise<void> {
  if (archived) {
    const open = await openPullOf(threadId);
    if (open)
      await moveLoop(open.id, "off", {
        reason: "The thread was archived.",
        autofix: false,
      });
  }
  await onProjectThreadArchived(threadId, archived);
}

export async function armReconcile(
  pullId: string,
  delayMs: number,
  expected?: string | null,
): Promise<string | undefined> {
  const work = async (): Promise<string | undefined> => {
    const runAt = new Date(Date.now() + delayMs);
    const jobId = await addJob(RECONCILE_JOB, { pullId }, { runAt, retryLimit: 1 });
    if (await setPendingJob(pullId, jobId, expected)) {
      if (expected === undefined) {
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
  };
  const hub = codeHub();
  return hub ? hub.serial(`code-pr-arm:${pullId}`, work) : work();
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

async function pullView(
  row: CodePullRow,
  ownerLogin: string | null,
  settings: AutofixSettings,
): Promise<PullView> {
  const snapshot = cachedSnapshot(row);
  const passes = await passesOf(row.id);
  const ignored = snapshot
    ? ignoredItems({
        snapshot,
        appCommentIds: await appCommentIds(row.id),
        ownerLogin,
        settings,
      })
    : [];
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
    loop: { status: row.loopStatus, reason: row.loopReason },
    yolo: row.yoloMethod ? { method: row.yoloMethod, waiting: row.yoloWaiting } : null,
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

function passItems(raw: string): Array<{ id: string; title: string }> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter((i): i is { id: string; title?: unknown } => typeof i?.id === "string")
      .map((i) => ({
        id: i.id,
        title: typeof i.title === "string" ? i.title : i.id,
      }));
  } catch {
    return [];
  }
}

const countUnknownWhenGitFails = (): null => null;
const landingUnknownWhenGitFails = (): null => null;

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
    if (open) await reconcileNow(open.id).catch(() => undefined);
    else await linkByBranch(threadId).catch(() => undefined);
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
  const ownerLogin = await codeGitHub()
    .client(project)
    .then((github) => ownerLoginOf(project, github))
    .catch(() => null);
  const settings = autofixSettings(project.settings);
  return {
    project: projectView(project),
    branch: thread.branch,
    active: active ? await pullView(active, ownerLogin, settings) : null,
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
