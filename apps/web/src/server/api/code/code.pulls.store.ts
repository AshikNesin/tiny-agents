/**
 * The rows behind PR links and Auto-fix (issue #297 §10): `code_pull_requests`
 * (a cache of GitHub plus the loop), `code_autofix_passes`, and the ids of
 * comments the app posted. Every loop and pass move is a compare-and-set
 * from the states its machine allows, so a racing reconcile or a late turn
 * end can never move a row along an edge the graph does not have.
 */
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { PullSnapshot } from "@tiny-agents/github";
import {
  codeAutofixPasses,
  codePrComments,
  codePullRequests,
  db,
  type CodeAutofixPass,
  type CodePullRow,
} from "../../db";
import { autofixMachine, type AutofixStatus } from "../../../shared/machines/autofix";
import { autofixPassMachine, type AutofixPassStatus } from "../../../shared/machines/autofix-pass";
import type { PassRecord } from "./code.autofix";

export async function getPull(id: string): Promise<CodePullRow | undefined> {
  return db.query.codePullRequests.findFirst({ where: eq(codePullRequests.id, id) });
}

/** The thread's open PR (its active one), if it has one. */
export async function openPullOf(threadId: string): Promise<CodePullRow | undefined> {
  return db.query.codePullRequests.findFirst({
    where: and(eq(codePullRequests.threadId, threadId), eq(codePullRequests.state, "open")),
  });
}

/** Every PR the thread has had, newest first. */
export async function pullsOf(threadId: string): Promise<CodePullRow[]> {
  return db
    .select()
    .from(codePullRequests)
    .where(eq(codePullRequests.threadId, threadId))
    .orderBy(desc(codePullRequests.createdAt));
}

export async function openPulls(): Promise<CodePullRow[]> {
  return db.select().from(codePullRequests).where(eq(codePullRequests.state, "open"));
}

export async function findPull(
  projectId: string,
  number: number,
): Promise<CodePullRow | undefined> {
  return db.query.codePullRequests.findFirst({
    where: and(eq(codePullRequests.projectId, projectId), eq(codePullRequests.number, number)),
  });
}

export interface LinkInput {
  threadId: string;
  projectId: string;
  number: number;
  url: string;
  title: string;
  headRef: string;
  baseRef: string;
  autofix: boolean;
  /** Start with GitHub's auto-merge wanted (the project's default). */
  autoMerge?: boolean;
}

/** Record a link; the open-PR-per-thread index refuses a second open one. */
export async function insertPull(input: LinkInput): Promise<CodePullRow> {
  const [row] = await db
    .insert(codePullRequests)
    .values({
      ...input,
      state: "open",
      loopStatus: input.autofix ? "watching" : "off",
      loopChangedAt: new Date(),
      ownerInputAt: new Date(),
    })
    .returning();
  return row!;
}

export async function deletePull(id: string): Promise<void> {
  await db.delete(codePullRequests).where(eq(codePullRequests.id, id));
}

/** Store a fresh snapshot (GitHub is the source of truth; this is its cache). */
export async function cacheSnapshot(id: string, snapshot: PullSnapshot): Promise<CodePullRow> {
  const [row] = await db
    .update(codePullRequests)
    .set({
      state: snapshot.state,
      draft: snapshot.draft,
      title: snapshot.title,
      headRef: snapshot.headRef,
      headSha: snapshot.headSha,
      baseRef: snapshot.baseRef,
      url: snapshot.url,
      snapshot: JSON.stringify(snapshot),
      syncedAt: new Date(),
    })
    .where(eq(codePullRequests.id, id))
    .returning();
  return row!;
}

export function cachedSnapshot(row: CodePullRow): PullSnapshot | null {
  if (!row.snapshot) return null;
  try {
    return JSON.parse(row.snapshot) as PullSnapshot;
  } catch {
    return null;
  }
}

/** Move the loop, compare-and-set; true when this caller moved it. */
export async function moveLoop(
  id: string,
  to: AutofixStatus,
  fields: {
    reason?: string | null;
    headSha?: string | null;
    autofix?: boolean;
    /** Narrow the states it may move from (still within the machine's). */
    from?: AutofixStatus[];
  } = {},
): Promise<boolean> {
  const sources = autofixMachine
    .sourcesOf(to)
    .filter((state) => !fields.from || fields.from.includes(state));
  if (sources.length === 0) return false;
  const moved = await db
    .update(codePullRequests)
    .set({
      loopStatus: to,
      loopReason: fields.reason ?? null,
      loopChangedAt: new Date(),
      ...(fields.headSha !== undefined ? { loopHeadSha: fields.headSha } : {}),
      ...(fields.autofix !== undefined ? { autofix: fields.autofix } : {}),
    })
    .where(and(eq(codePullRequests.id, id), inArray(codePullRequests.loopStatus, sources)))
    .returning({ id: codePullRequests.id });
  return moved.length > 0;
}

export async function updatePull(
  id: string,
  set: Partial<
    Pick<
      CodePullRow,
      | "autofix"
      | "autoMerge"
      | "passesWithoutOwner"
      | "ownerInputAt"
      | "pendingJobId"
      | "stalledNotifiedSha"
    >
  >,
): Promise<void> {
  await db.update(codePullRequests).set(set).where(eq(codePullRequests.id, id));
}

/**
 * Point the PR's reconcile chain at job `to`: only from the job that is its
 * current link (`expected`), so a duplicate run never forks the chain, or
 * unconditionally (`expected` undefined) when arming a fresh chain.
 */
export async function setPendingJob(
  id: string,
  to: string | null,
  expected?: string | null,
): Promise<boolean> {
  const guard =
    expected === undefined
      ? eq(codePullRequests.id, id)
      : and(
          eq(codePullRequests.id, id),
          expected === null
            ? isNull(codePullRequests.pendingJobId)
            : eq(codePullRequests.pendingJobId, expected),
        );
  const moved = await db
    .update(codePullRequests)
    .set({ pendingJobId: to })
    .where(guard)
    .returning({ id: codePullRequests.id });
  return moved.length > 0;
}

// --- passes --------------------------------------------------------------------------

export async function passesOf(pullId: string): Promise<CodeAutofixPass[]> {
  return db
    .select()
    .from(codeAutofixPasses)
    .where(eq(codeAutofixPasses.pullId, pullId))
    .orderBy(desc(codeAutofixPasses.createdAt));
}

export function passRecord(row: CodeAutofixPass): PassRecord {
  let items: string[] = [];
  try {
    items = (JSON.parse(row.items) as Array<{ id: string }>).map((i) => i.id);
  } catch {
    items = [];
  }
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    items,
    createdAt: row.createdAt.getTime(),
    startedAt: row.startedAt?.getTime() ?? null,
    pushedSha: row.pushedSha,
  };
}

/** Claim a pass for one state of the PR: the loser of a race for the same hash gets undefined. */
export async function claimPass(input: {
  pullId: string;
  trigger: string;
  stateHash: string;
  items: unknown[];
}): Promise<CodeAutofixPass | undefined> {
  const [row] = await db
    .insert(codeAutofixPasses)
    .values({
      pullId: input.pullId,
      trigger: input.trigger,
      stateHash: input.stateHash,
      items: JSON.stringify(input.items),
      status: "starting",
    })
    .onConflictDoNothing()
    .returning();
  return row;
}

export async function movePass(
  id: string,
  to: AutofixPassStatus,
  set: Partial<
    Pick<
      CodeAutofixPass,
      | "startSha"
      | "pushedSha"
      | "outcome"
      | "detail"
      | "startedAt"
      | "finishedAt"
      | "startCostUsd"
      | "costUsd"
    >
  > = {},
): Promise<boolean> {
  const moved = await db
    .update(codeAutofixPasses)
    .set({ status: to, ...set })
    .where(
      and(
        eq(codeAutofixPasses.id, id),
        inArray(codeAutofixPasses.status, autofixPassMachine.sourcesOf(to)),
      ),
    )
    .returning({ id: codeAutofixPasses.id });
  return moved.length > 0;
}

/** The running pass of a PR, if any. */
export async function runningPass(pullId: string): Promise<CodeAutofixPass | undefined> {
  return db.query.codeAutofixPasses.findFirst({
    where: and(eq(codeAutofixPasses.pullId, pullId), ne(codeAutofixPasses.status, "finished")),
  });
}

// --- the app's comments -------------------------------------------------------------------

export async function recordAppComment(pullId: string, githubId: number, passId?: string) {
  await db
    .insert(codePrComments)
    .values({ id: githubId, pullId, passId: passId ?? null })
    .onConflictDoNothing();
}

export async function appCommentIds(pullId: string): Promise<Set<number>> {
  const rows = await db
    .select({ id: codePrComments.id })
    .from(codePrComments)
    .where(eq(codePrComments.pullId, pullId));
  return new Set(rows.map((r) => r.id));
}
