import { createHash } from "node:crypto";
import type { Author, PullSnapshot } from "@tiny-agents/github";
import type { AutofixStatus } from "../../../shared/machines/autofix";

export interface AutofixSettings {
  triggers: { checks: boolean; reviews: boolean; conflicts: boolean; mergeQueue: boolean };
  finalCheck: boolean;
  trustedBots: string[];
  hourlyLimit: number;
  noOwnerLimit: number;
  passMinutes: number;
  quietSeconds: number;
  conflictAttempts: number;
  stallHours: number;
}

export const DEFAULT_AUTOFIX: AutofixSettings = {
  triggers: { checks: true, reviews: true, conflicts: true, mergeQueue: true },
  finalCheck: false,
  trustedBots: [],
  hourlyLimit: 6,
  noOwnerLimit: 10,
  passMinutes: 20,
  quietSeconds: 60,
  conflictAttempts: 3,
  stallHours: 6,
};

export const APP_MARKER = "<!-- tiny-agents:autofix";

type ItemKind = "check" | "review" | "thread" | "conflict" | "queue" | "final";

export interface AutofixItem {
  id: string;
  kind: ItemKind;
  at: number;
  title: string;
  text: string;
  path?: string;
  line?: number | null;
  threadId?: string;
  jobId?: number | null;
}

export interface PassRecord {
  id: string;
  trigger: string;
  status: "starting" | "running" | "finished";
  items: string[];
  createdAt: number;
  startedAt: number | null;
  pushedSha: string | null;
}

export interface DecideInput {
  snapshot: PullSnapshot;
  loop: {
    enabled: boolean;
    status: AutofixStatus;
    changedAt: number | null;
    headAtChange: string | null;
    passesWithoutOwner: number;
    ownerInputAt: number | null;
  };
  passes: PassRecord[];
  appCommentIds: ReadonlySet<number>;
  ownerLogin: string | null;
  settings: AutofixSettings;
  now: number;
  spend?: { usd: number | null; limitUsd: number | null };
}

export type Decision =
  | { kind: "none"; reason?: string }
  | { kind: "wait"; until: number }
  | {
      kind: "pass";
      trigger: "checks" | "review" | "conflict" | "queue" | "final";
      items: AutofixItem[];
      hash: string;
    }
  | { kind: "green" }
  | { kind: "resume" }
  | { kind: "timeout"; passId: string }
  | { kind: "needs_input"; reason: string }
  | { kind: "pause"; reason: string }
  | { kind: "off"; reason: string }
  | { kind: "merged" };

const TRUSTED_ASSOCIATIONS: readonly string[] = ["OWNER", "MEMBER", "COLLABORATOR"];
const HOUR_MS = 60 * 60_000;

function isTrusted(
  author: Author,
  ownerLogin: string | null,
  settings: Pick<AutofixSettings, "trustedBots">,
): boolean {
  if (ownerLogin && author.login.toLowerCase() === ownerLogin.toLowerCase()) return true;
  if (author.type === "bot") {
    return settings.trustedBots.some((bot) => bot.toLowerCase() === author.login.toLowerCase());
  }
  return TRUSTED_ASSOCIATIONS.includes(author.association);
}

function isAppComment(
  comment: { databaseId: number; body: string },
  appCommentIds: ReadonlySet<number>,
): boolean {
  return appCommentIds.has(comment.databaseId) || comment.body.includes(APP_MARKER);
}

const dollars = (usd: number) => "$" + usd.toFixed(2);

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

export function stalledChecks(snapshot: PullSnapshot, now: number, stallHours: number) {
  return snapshot.checks.filter(
    (c) => c.state === "pending" && c.startedAt && now - time(c.startedAt) > stallHours * HOUR_MS,
  );
}

export function actionableItems(
  input: Pick<DecideInput, "snapshot" | "appCommentIds" | "ownerLogin" | "settings">,
): AutofixItem[] {
  const { snapshot, settings } = input;
  const trusted = (author: Author) => isTrusted(author, input.ownerLogin, settings);
  const items: AutofixItem[] = [];
  if (settings.triggers.conflicts && snapshot.mergeable === "conflicting") {
    items.push({
      id: `conflict:${snapshot.headSha}:${snapshot.baseRef}`,
      kind: "conflict",
      at: 0,
      title: `Merge conflict with ${snapshot.baseRef}`,
      text: `The branch conflicts with ${snapshot.baseRef}.`,
    });
  }
  if (settings.triggers.checks) {
    for (const check of snapshot.checks) {
      if (check.state !== "failure") continue;
      items.push({
        id: `check:${snapshot.headSha}:${check.name}`,
        kind: "check",
        at: time(check.completedAt),
        title: `Check failed: ${check.name}`,
        text: check.url ? `${check.name} failed (${check.url}).` : `${check.name} failed.`,
        jobId: check.jobId,
      });
    }
  }
  if (settings.triggers.reviews) {
    for (const review of snapshot.reviews) {
      const wanted =
        review.state === "CHANGES_REQUESTED" ||
        (review.state === "COMMENTED" && review.body.trim() !== "");
      if (!wanted || !trusted(review.author)) continue;
      if (review.body.includes(APP_MARKER)) continue;
      items.push({
        id: `review:${review.id}`,
        kind: "review",
        at: time(review.submittedAt),
        title: `Review from ${review.author.login}`,
        text: review.body.trim() || "Changes requested.",
      });
    }
    for (const thread of snapshot.threads) {
      if (thread.resolved) continue;
      const latest = thread.comments.at(-1);
      if (!latest || !trusted(latest.author) || isAppComment(latest, input.appCommentIds)) continue;
      items.push({
        id: `thread:${thread.id}:${latest.databaseId}`,
        kind: "thread",
        at: time(latest.createdAt),
        title: `Comment on ${thread.path}${thread.line ? `:${thread.line}` : ""}`,
        text: thread.comments
          .filter((c) => !isAppComment(c, input.appCommentIds))
          .map((c) => `${c.author.login}: ${c.body}`)
          .join("\n\n"),
        path: thread.path,
        line: thread.line,
        threadId: thread.id,
      });
    }
  }
  if (settings.triggers.mergeQueue && !snapshot.inMergeQueue) {
    const removal = snapshot.queueRemovals.at(-1);
    if (removal) {
      items.push({
        id: `queue:${removal.id}`,
        kind: "queue",
        at: time(removal.at),
        title: "Removed from the merge queue",
        text: removal.reason || "The merge queue removed the pull request.",
      });
    }
  }
  return items;
}

export function ignoredItems(
  input: Pick<DecideInput, "snapshot" | "appCommentIds" | "ownerLogin" | "settings">,
): string[] {
  const { snapshot, settings } = input;
  const untrusted = (author: Author) => !isTrusted(author, input.ownerLogin, settings);
  const ignored: string[] = [];
  for (const thread of snapshot.threads) {
    if (thread.resolved) continue;
    const latest = thread.comments.at(-1);
    if (latest && !isAppComment(latest, input.appCommentIds) && untrusted(latest.author)) {
      ignored.push(thread.id);
    }
  }
  for (const review of snapshot.reviews) {
    const wanted =
      review.state === "CHANGES_REQUESTED" ||
      (review.state === "COMMENTED" && review.body.trim() !== "");
    if (wanted && !review.body.includes(APP_MARKER) && untrusted(review.author)) {
      ignored.push(review.id);
    }
  }
  return ignored;
}

export function checksJustFailed(prev: PullSnapshot | null, next: PullSnapshot): string[] {
  if (next.checks.some((c) => c.state === "pending")) return [];
  const justFinished =
    !prev || prev.headSha !== next.headSha || prev.checks.some((c) => c.state === "pending");
  if (!justFinished) return [];
  return next.checks.filter((c) => c.state === "failure").map((c) => c.name);
}

export function stateHash(headSha: string, itemIds: string[]): string {
  return createHash("sha256")
    .update(`${headSha}\n${[...itemIds].sort().join("\n")}`)
    .digest("hex")
    .slice(0, 32);
}

export function decide(input: DecideInput): Decision {
  const { snapshot, loop, settings, now, passes } = input;
  if (snapshot.state === "merged")
    return loop.status === "merged" ? { kind: "none" } : { kind: "merged" };
  if (!loop.enabled || loop.status === "off" || loop.status === "merged") return { kind: "none" };
  if (snapshot.state === "closed") return { kind: "off", reason: "The pull request was closed." };
  if (snapshot.fromFork)
    return { kind: "off", reason: "Pull requests from forks are never fixed." };

  const running = passes.find((p) => p.status !== "finished");
  if (running) {
    const since = running.startedAt ?? running.createdAt;
    if (now - since > settings.passMinutes * 60_000) return { kind: "timeout", passId: running.id };
    return { kind: "none", reason: "A pass is running." };
  }

  const handled = new Set(passes.flatMap((p) => p.items));
  const all = actionableItems(input);
  const fresh = all.filter((item) => !handled.has(item.id));

  if (loop.status === "needs_input") {
    return loop.ownerInputAt && loop.ownerInputAt > (loop.changedAt ?? 0)
      ? { kind: "resume" }
      : { kind: "none", reason: "Waiting for you." };
  }
  if (loop.status === "paused") {
    const since = loop.changedAt ?? 0;
    const ours = new Set(passes.map((p) => p.pushedSha).filter(Boolean));
    const humanPush =
      loop.headAtChange !== null &&
      snapshot.headSha !== loop.headAtChange &&
      !ours.has(snapshot.headSha);
    const humanWrote =
      (loop.ownerInputAt ?? 0) > since ||
      fresh.some((item) => (item.kind === "review" || item.kind === "thread") && item.at > since);
    return humanPush || humanWrote ? { kind: "resume" } : { kind: "none", reason: "Paused." };
  }

  let items = fresh;
  const conflictPasses = passes.filter((p) => p.trigger === "conflict").length;
  if (conflictPasses >= settings.conflictAttempts && items.some((i) => i.kind === "conflict")) {
    items = items.filter((i) => i.kind !== "conflict");
    if (items.length === 0) {
      return {
        kind: "needs_input",
        reason: `The merge conflict is still there after ${conflictPasses} attempts.`,
      };
    }
  }

  if (items.length > 0) {
    if (loop.passesWithoutOwner >= settings.noOwnerLimit) {
      return {
        kind: "off",
        reason: `${loop.passesWithoutOwner} passes in a row without you. Switch Auto-fix on again to continue.`,
      };
    }
    const { usd, limitUsd } = input.spend ?? { usd: null, limitUsd: null };
    if (usd !== null && limitUsd !== null && usd >= limitUsd) {
      return {
        kind: "pause",
        reason: `The thread's spend limit is reached (${dollars(usd)} of ${dollars(limitUsd)}). Raise it to go on.`,
      };
    }
    const lastHour = passes.filter((p) => now - p.createdAt < HOUR_MS).length;
    if (lastHour >= settings.hourlyLimit) {
      return {
        kind: "pause",
        reason: `${lastHour} passes in the last hour. Paused until someone pushes, reviews or writes.`,
      };
    }
    const newest = Math.max(...items.map((i) => i.at));
    const until = newest + settings.quietSeconds * 1000;
    if (until > now) return { kind: "wait", until };
    const trigger = items.some((i) => i.kind === "conflict")
      ? "conflict"
      : items.some((i) => i.kind === "check")
        ? "checks"
        : items.some((i) => i.kind === "queue")
          ? "queue"
          : "review";
    return {
      kind: "pass",
      trigger,
      items,
      hash: stateHash(
        snapshot.headSha,
        items.map((i) => i.id),
      ),
    };
  }

  if (loop.status === "green") return { kind: "none" };
  if (!isGreen(input, all)) return { kind: "none" };
  const final = `final:${snapshot.headSha}`;
  if (settings.finalCheck && !handled.has(final)) {
    return {
      kind: "pass",
      trigger: "final",
      items: [
        {
          id: final,
          kind: "final",
          at: 0,
          title: "Final check",
          text: "Checks are green and nothing is open.",
        },
      ],
      hash: stateHash(snapshot.headSha, [final]),
    };
  }
  return { kind: "green" };
}

function isGreen(input: DecideInput, items: AutofixItem[]): boolean {
  const { snapshot, now, settings } = input;
  if (snapshot.mergeable !== "mergeable") return false;
  const stalled = new Set(stalledChecks(snapshot, now, settings.stallHours).map((c) => c.name));
  const checksDone = snapshot.checks.every(
    (c) => c.state === "success" || c.state === "neutral" || stalled.has(c.name),
  );
  return checksDone && items.length === 0;
}

export function nextLookMs(
  snapshot: Pick<PullSnapshot, "state" | "checks">,
  loopStatus: AutofixStatus,
  lastPushAt: number | null,
  now: number,
  stallHours = DEFAULT_AUTOFIX.stallHours,
): number | null {
  if (snapshot.state !== "open") return null;
  const MIN = 60_000;
  if (loopStatus === "fixing") return MIN;
  if (lastPushAt && now - lastPushAt < 30 * MIN) return MIN;
  const pending = snapshot.checks.filter((c) => c.state === "pending");
  if (pending.length > 0) {
    const allStalled = pending.every(
      (c) => c.startedAt && now - time(c.startedAt) > stallHours * HOUR_MS,
    );
    if (allStalled) return 30 * MIN;
    const changed = Math.max(
      0,
      ...snapshot.checks.flatMap((c) => [time(c.startedAt), time(c.completedAt)]),
    );
    return now - changed < 30 * MIN ? MIN : 5 * MIN;
  }
  return 5 * MIN;
}
