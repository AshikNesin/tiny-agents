import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
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
import { codeHub } from "./code.hub";

const listChanged = () => codeHub()?.listChanged();

export async function getPull(id: string): Promise<CodePullRow | undefined> {
  return db.query.codePullRequests.findFirst({ where: eq(codePullRequests.id, id) });
}

export async function openPullOf(threadId: string): Promise<CodePullRow | undefined> {
  return db.query.codePullRequests.findFirst({
    where: and(eq(codePullRequests.threadId, threadId), eq(codePullRequests.state, "open")),
  });
}

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
}

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
    .onConflictDoNothing()
    .returning();
  if (row) {
    listChanged();
    return row;
  }
  const existing =
    (await openPullOf(input.threadId)) ?? (await findPull(input.projectId, input.number));
  if (existing) return existing;
  throw Boom.conflict("The pull request is already linked. Reload the thread.");
}

export async function deletePull(id: string): Promise<void> {
  await db.delete(codePullRequests).where(eq(codePullRequests.id, id));
  listChanged();
}

export async function cacheSnapshot(
  id: string,
  snapshot: PullSnapshot,
): Promise<CodePullRow | undefined> {
  const set = {
    state: snapshot.state,
    draft: snapshot.draft,
    title: snapshot.title,
    headRef: snapshot.headRef,
    headSha: snapshot.headSha,
    baseRef: snapshot.baseRef,
    url: snapshot.url,
    snapshot: JSON.stringify(snapshot),
    syncedAt: new Date(),
  };
  const [moved] = await db
    .update(codePullRequests)
    .set(set)
    .where(and(eq(codePullRequests.id, id), ne(codePullRequests.state, snapshot.state)))
    .returning();
  if (moved) {
    listChanged();
    return moved;
  }
  const [row] = await db
    .update(codePullRequests)
    .set(set)
    .where(eq(codePullRequests.id, id))
    .returning();
  return row;
}

export function cachedSnapshot(row: CodePullRow): PullSnapshot | null {
  if (!row.snapshot) return null;
  try {
    return JSON.parse(row.snapshot) as PullSnapshot;
  } catch {
    return null;
  }
}

export async function moveLoop(
  id: string,
  to: AutofixStatus,
  fields: {
    reason?: string | null;
    headSha?: string | null;
    autofix?: boolean;
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
  if (moved.length > 0) listChanged();
  return moved.length > 0;
}

export async function updatePull(
  id: string,
  set: Partial<
    Pick<
      CodePullRow,
      | "autofix"
      | "passesWithoutOwner"
      | "ownerInputAt"
      | "pendingJobId"
      | "stalledNotifiedSha"
      | "yoloMethod"
      | "yoloWaiting"
    >
  >,
): Promise<void> {
  await db.update(codePullRequests).set(set).where(eq(codePullRequests.id, id));
}

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

export async function runningPass(pullId: string): Promise<CodeAutofixPass | undefined> {
  return db.query.codeAutofixPasses.findFirst({
    where: and(eq(codeAutofixPasses.pullId, pullId), ne(codeAutofixPasses.status, "finished")),
  });
}

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
