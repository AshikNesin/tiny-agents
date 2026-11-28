import { eq, inArray } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { notificationService } from "@groot/core/notification/notification.service";
import { addJob } from "@groot/jobs/server/queue";
import { registerJobHandler } from "@groot/jobs/server/worker";
import { GitHubError, type GitHubClient, type PullSnapshot } from "@tiny-agents/github";
import { codeThreads, db, jobs, type CodePullRow, type CodeProjectRow } from "../../db";
import { codePullUpdate, type CodePullKind } from "../notifications/notifications.events";
import {
  checksJustFailed,
  DEFAULT_AUTOFIX,
  decide,
  nextLookMs,
  stalledChecks,
  type AutofixSettings,
} from "./code.autofix";
import { cancelPendingJob } from "../pending-jobs";
import { codeGitHub } from "./code.github";
import { codeHub } from "./code.hub";
import { threadKey } from "./code.threads";
import { reportPull, type PullReportKind } from "./code.report";
import { finishPass, startPass, timeOutPass } from "./code.passes";
import { yoloWaiting } from "./code.yolo";
import { onProjectThreadArchived, projectSettings, projectThread, repoOf } from "./code.projects";
import {
  appCommentIds,
  cacheSnapshot,
  cachedSnapshot,
  getPull,
  moveLoop,
  openPullOf,
  openPulls,
  passRecord,
  passesOf,
  runningPass,
  setPendingJob,
  updatePull,
} from "./code.pulls.store";

export const RECONCILE_JOB = "code-pr-reconcile";

export function autofixSettings(raw: string): AutofixSettings {
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

export async function ownerLoginOf(
  project: { transport: string },
  github: Pick<GitHubClient, "viewer">,
): Promise<string | null> {
  if (project.transport === "app") return null;
  return (await github.viewer()).login;
}

function logUnreadTurn(error: unknown, pullId: string): undefined {
  logger.warn({ error, pull: pullId }, "Code: could not read how the Auto-fix turn ended");
}

function logUntoldProjectChat(error: unknown, threadId: string) {
  logger.warn({ error, threadId }, "Code: could not tell the project chat about a PR");
}

export async function tellProjectChat(pull: CodePullRow, kind: PullReportKind, detail?: string) {
  await reportPull(pull, kind, detail).catch((error: unknown) =>
    logUntoldProjectChat(error, pull.threadId),
  );
}

async function notify(pull: CodePullRow, kind: CodePullKind, detail?: string) {
  await tellProjectChat(pull, kind, detail);
  if ((codeHub()?.viewers(pull.threadId) ?? 0) > 0) return;
  notificationService.notify(codePullUpdate(pull, kind, detail));
}

export const githubMessage = (error: unknown) =>
  error instanceof GitHubError || error instanceof Error ? error.message : String(error);

export const YOLO_LOOK_MS = 30_000;

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
  await notify(pull, "merged");
  return "merged";
}

export async function reconcileNow(pullId: string): Promise<number | null> {
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
    await notify(pull, "merged");
    if (projectSettings(project.settings).archiveOnMerge) await archiveThread(pull.threadId);
    return null;
  }
  if (snapshot.state === "closed") {
    await moveLoop(pull.id, "off", {
      reason: "The pull request was closed.",
      autofix: false,
    });
    if (
      projectSettings(project.settings).archiveOnMerge &&
      !(await holdsUncommittedWork(services, project, found.thread.worktree))
    ) {
      await archiveThread(pull.threadId);
    }
    return null;
  }

  const stalled = stalledChecks(snapshot, now, settings.stallHours);
  if (stalled.length && pull.stalledNotifiedSha !== snapshot.headSha) {
    await updatePull(pull.id, { stalledNotifiedSha: snapshot.headSha });
    await notify(
      pull,
      "stalled",
      `${stalled.map((c) => c.name).join(", ")} has been pending for hours.`,
    );
  }

  const running = await runningPass(pull.id);
  if (running?.status === "running") {
    const target = codeHub()?.resolve(pull.threadId);
    const outcome = await target?.instance
      .outcome(target.nativeId)
      .catch((error: unknown) => logUnreadTurn(error, pullId));
    if (
      outcome &&
      !outcome.working &&
      (outcome.endedAt ?? 0) >= (running.startedAt?.getTime() ?? 0)
    ) {
      await finishPass(running, outcome);
      pull = (await getPull(pull.id)) ?? pull;
    }
  }

  let ownerLogin: string | null;
  try {
    ownerLogin = await ownerLoginOf(project, github);
  } catch (error) {
    logger.warn({ error, pull: pullId }, "Code: could not tell who owns a linked pull request");
    return 5 * 60_000;
  }
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
      if (await moveLoop(pull.id, "green", { headSha: snapshot.headSha }))
        await notify(pull, "green");
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
        await notify(pull, "needs_input", decision.reason);
      }
    } else if (decision.kind === "pause") {
      if (
        await moveLoop(pull.id, "paused", {
          reason: decision.reason,
          headSha: snapshot.headSha,
        })
      ) {
        await notify(pull, "needs_input", decision.reason);
      }
    } else if (decision.kind === "off") {
      if (
        await moveLoop(pull.id, "off", {
          reason: decision.reason,
          autofix: false,
        })
      ) {
        await notify(pull, "off", decision.reason);
      }
    } else if (decision.kind === "none" && !pull.autofix) {
      const failed = checksJustFailed(cachedSnapshot(before), snapshot);
      if (failed.length) await notify(pull, "checks_failed", failed.join(", "));
    }
    break;
  }
  const latest = (await getPull(pull.id)) ?? pull;
  const next = nextLookMs(snapshot, latest.loopStatus, lastPushAt, now, settings.stallHours);
  return latest.yoloMethod && next !== null ? Math.min(next, YOLO_LOOK_MS) : next;
}

async function holdsUncommittedWork(
  services: ReturnType<typeof codeGitHub>,
  project: CodeProjectRow,
  worktree: string | null,
): Promise<boolean> {
  if (!worktree) return false;
  const ws = await services.workspace(project);
  if (!(await ws.exists(worktree))) return false;
  return (await ws.uncommitted(worktree)).length > 0;
}

async function archiveThread(threadId: string): Promise<void> {
  try {
    await archiveCodeThread(threadId, true);
  } catch (error) {
    logger.warn({ error, threadId }, "Code: could not archive a finished thread");
  }
}

export async function archiveCodeThread(threadId: string, archived: boolean): Promise<string[]> {
  const target = codeHub()?.resolve(threadId);
  const canArchive = target?.instance.archive && target.instance.capabilities().threads.archive;
  const moved = canArchive
    ? (await target.instance.archive!(target.nativeId, archived)).moved.map((child) =>
        threadKey(target.instance.id, child),
      )
    : [];
  for (const id of new Set([threadId, ...moved])) {
    await db.update(codeThreads).set({ archived }).where(eq(codeThreads.id, id));
    const open = archived ? await openPullOf(id) : undefined;
    if (open)
      await moveLoop(open.id, "off", { reason: "The thread was archived.", autofix: false });
    await onProjectThreadArchived(id, archived);
  }
  if (target) void codeHub()?.refresh(target.instance.id);
  return moved;
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
            await cancelPendingJob(job.id);
          }
        }
      }
      return jobId;
    }
    await cancelPendingJob(jobId);
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
