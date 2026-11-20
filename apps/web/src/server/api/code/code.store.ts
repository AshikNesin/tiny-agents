import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  LEGACY_INSTANCE_ID,
  parseThreadId,
  threadIdOf,
  type IndexedThread,
  type ThreadIndex,
} from "@tiny-agents/code/server";
import {
  codeHandoffFinishes,
  codeHandoffs,
  codePullRequests,
  codeReviews,
  codeThreads,
  db,
  shelleyHandoffs,
  shelleySeen,
  type CodeHandoff,
  type CodeThreadRow,
} from "../../db";
import { branchTitle, isProjectHeaderTitle } from "../../../shared/code-messages";
import { handoffMachine } from "../../../shared/machines/handoff";

function parseData(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toIndexed(row: CodeThreadRow): IndexedThread {
  return {
    instanceId: row.instanceId,
    nativeId: row.nativeId,
    title: (isProjectHeaderTitle(row.title) && branchTitle(row.branch)) || row.title,
    cwd: row.cwd,
    parentNativeId: row.parentNativeId,
    model: row.model,
    effort: row.effort,
    permissionMode: row.permissionMode,
    archived: row.archived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    data: parseData(row.data),
  };
}

export const threadIndex: ThreadIndex = {
  async list(instanceId) {
    const rows = await db
      .select()
      .from(codeThreads)
      .where(eq(codeThreads.instanceId, instanceId))
      .orderBy(desc(codeThreads.updatedAt));
    return rows.map(toIndexed);
  },
  async get(instanceId, nativeId) {
    const [row] = await db
      .select()
      .from(codeThreads)
      .where(eq(codeThreads.id, threadIdOf(instanceId, nativeId)));
    return row ? toIndexed(row) : undefined;
  },
  async upsert(input) {
    const id = threadIdOf(input.instanceId, input.nativeId);
    const set: Partial<typeof codeThreads.$inferInsert> = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      ...(input.parentNativeId !== undefined ? { parentNativeId: input.parentNativeId } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.effort !== undefined ? { effort: input.effort } : {}),
      ...(input.permissionMode !== undefined ? { permissionMode: input.permissionMode } : {}),
      ...(input.archived !== undefined ? { archived: input.archived } : {}),
      ...(input.data !== undefined ? { data: JSON.stringify(input.data) } : {}),
      updatedAt: input.updatedAt ?? new Date(),
    };
    await db
      .insert(codeThreads)
      .values({
        id,
        instanceId: input.instanceId,
        nativeId: input.nativeId,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        ...set,
      })
      .onConflictDoUpdate({ target: codeThreads.id, set });
    const [row] = await db.select().from(codeThreads).where(eq(codeThreads.id, id));
    return toIndexed(row!);
  },
  async remove(instanceId, nativeId) {
    await db.delete(codeThreads).where(eq(codeThreads.id, threadIdOf(instanceId, nativeId)));
  },
};

export async function follow(instanceId: string, nativeId: string): Promise<void> {
  const id = threadIdOf(instanceId, nativeId);
  await db
    .insert(codeThreads)
    .values({ id, instanceId, nativeId, followed: true })
    .onConflictDoUpdate({ target: codeThreads.id, set: { followed: true } });
}

export async function markSeen(
  instanceId: string,
  nativeId: string,
  cursor: number,
): Promise<void> {
  const id = threadIdOf(instanceId, nativeId);
  await db
    .insert(codeThreads)
    .values({ id, instanceId, nativeId, followed: true, seenCursor: cursor })
    .onConflictDoUpdate({
      target: codeThreads.id,
      set: {
        followed: true,
        seenCursor: sql`max(${codeThreads.seenCursor}, ${cursor})`,
      },
    });
}

export async function seenMap(): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: codeThreads.id, cursor: codeThreads.seenCursor })
    .from(codeThreads)
    .where(eq(codeThreads.followed, true));
  return new Map(rows.map((r) => [r.id, r.cursor]));
}

export interface ThreadDecoration {
  projectId: string | null;
  pr: { number: number; loop: string; url: string } | null;
  review: { id: string; number: number } | null;
}

export async function threadDecorations(): Promise<Map<string, ThreadDecoration>> {
  const [threads, pulls, reviews] = await Promise.all([
    db
      .select({ id: codeThreads.id, projectId: codeThreads.projectId })
      .from(codeThreads)
      .where(isNotNull(codeThreads.projectId)),
    db
      .select({
        threadId: codePullRequests.threadId,
        number: codePullRequests.number,
        url: codePullRequests.url,
        loop: codePullRequests.loopStatus,
      })
      .from(codePullRequests)
      .where(eq(codePullRequests.state, "open")),
    db
      .select({ id: codeReviews.id, number: codeReviews.number, threadId: codeReviews.threadId })
      .from(codeReviews)
      .where(isNotNull(codeReviews.threadId)),
  ]);
  const out = new Map<string, ThreadDecoration>();
  const entry = (id: string) => {
    const found = out.get(id) ?? { projectId: null, pr: null, review: null };
    out.set(id, found);
    return found;
  };
  for (const t of threads) entry(t.id).projectId = t.projectId;
  for (const p of pulls) entry(p.threadId).pr = { number: p.number, loop: p.loop, url: p.url };
  for (const r of reviews) entry(r.threadId!).review = { id: r.id, number: r.number };
  return out;
}

export async function isFollowed(threadId: string): Promise<boolean> {
  const [row] = await db
    .select({ followed: codeThreads.followed })
    .from(codeThreads)
    .where(eq(codeThreads.id, threadId));
  return Boolean(row?.followed);
}

export type ThreadHandoff = CodeHandoff & { threadId: string };

const hasThread = (row: CodeHandoff | undefined): row is ThreadHandoff =>
  row !== undefined && row.threadId !== null;

export interface HandoffInput {
  botId: string;
  conversationId: string;
  idempotencyKey: string;
  task: string;
  cwd?: string;
  threadId: string;
  title?: string | null;
}

export async function findHandoffByKey(key: string): Promise<CodeHandoff | undefined> {
  return db.query.codeHandoffs.findFirst({ where: eq(codeHandoffs.idempotencyKey, key) });
}

export async function recordHandoff(input: HandoffInput): Promise<ThreadHandoff> {
  await db
    .insert(codeHandoffs)
    .values({
      botId: input.botId,
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
      task: input.task,
      cwd: input.cwd ?? null,
      threadId: input.threadId,
      title: input.title ?? null,
      status: "running",
    })
    .onConflictDoNothing();
  const row = await findHandoffByKey(input.idempotencyKey);
  if (!hasThread(row)) throw new Error("hand-off row missing after insert");
  return row;
}

export async function claimHandoff(
  input: Omit<HandoffInput, "threadId" | "title">,
): Promise<boolean> {
  const claimed = await db
    .insert(codeHandoffs)
    .values({
      botId: input.botId,
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
      task: input.task,
      cwd: input.cwd ?? null,
      threadId: null,
      status: "starting",
    })
    .onConflictDoNothing()
    .returning({ id: codeHandoffs.id });
  return claimed.length > 0;
}

export async function startedHandoff(key: string, threadId: string): Promise<ThreadHandoff> {
  await db
    .update(codeHandoffs)
    .set({ threadId, status: "running" })
    .where(and(eq(codeHandoffs.idempotencyKey, key), eq(codeHandoffs.status, "starting")));
  const row = await findHandoffByKey(key);
  if (!hasThread(row)) throw new Error("hand-off row missing after start");
  return row;
}

export async function dropHandoffClaim(key: string): Promise<void> {
  await db
    .delete(codeHandoffs)
    .where(and(eq(codeHandoffs.idempotencyKey, key), eq(codeHandoffs.status, "starting")));
}

export async function forgetHandoff(id: string): Promise<void> {
  await db
    .delete(codeHandoffs)
    .where(and(eq(codeHandoffs.id, id), eq(codeHandoffs.status, "running")));
}

export async function listHandoffs(
  botId: string,
  options: { limit?: number; instanceId?: string } = {},
): Promise<ThreadHandoff[]> {
  const rows = (
    await db
      .select()
      .from(codeHandoffs)
      .where(and(eq(codeHandoffs.botId, botId), isNotNull(codeHandoffs.threadId)))
      .orderBy(desc(codeHandoffs.createdAt))
      .limit(options.instanceId ? 200 : (options.limit ?? 20))
  ).filter(hasThread);
  const filtered = options.instanceId
    ? rows.filter(
        (r) => parseThreadId(r.threadId, LEGACY_INSTANCE_ID)?.instanceId === options.instanceId,
      )
    : rows;
  return filtered.slice(0, options.limit ?? 20);
}

export async function findHandoff(
  botId: string,
  threadId: string,
): Promise<ThreadHandoff | undefined> {
  const row = await db.query.codeHandoffs.findFirst({
    where: and(eq(codeHandoffs.botId, botId), eq(codeHandoffs.threadId, threadId)),
    orderBy: desc(codeHandoffs.createdAt),
  });
  return hasThread(row) ? row : undefined;
}

export async function reopenHandoff(id: string): Promise<void> {
  await db
    .update(codeHandoffs)
    .set({ status: "running", finishedAt: new Date() })
    .where(
      and(
        eq(codeHandoffs.id, id),
        inArray(codeHandoffs.status, handoffMachine.sourcesOf("running")),
      ),
    );
}

export async function askedFrom(id: string, conversationId: string): Promise<string | null> {
  const row = await db.query.codeHandoffs.findFirst({
    where: eq(codeHandoffs.id, id),
    columns: { conversationId: true },
  });
  await db.update(codeHandoffs).set({ conversationId }).where(eq(codeHandoffs.id, id));
  return row?.conversationId ?? null;
}

export function endsHandoff(handoff: CodeHandoff, endedAt: number): boolean {
  return handoff.finishedAt
    ? endedAt > handoff.finishedAt.getTime()
    : endedAt >= handoff.createdAt.getTime();
}

export async function runningHandoffs(threadIds?: string[]): Promise<ThreadHandoff[]> {
  const running = eq(codeHandoffs.status, "running");
  const rows = await db
    .select()
    .from(codeHandoffs)
    .where(threadIds ? and(running, inArray(codeHandoffs.threadId, threadIds)) : running);
  return rows.filter(hasThread);
}

export async function finishHandoffOnce(id: string): Promise<boolean> {
  const updated = await db
    .update(codeHandoffs)
    .set({ status: "finished", finishedAt: new Date() })
    .where(
      and(
        eq(codeHandoffs.id, id),
        inArray(codeHandoffs.status, handoffMachine.sourcesOf("finished")),
      ),
    )
    .returning({ id: codeHandoffs.id });
  return updated.length > 0;
}

export interface OwedFinish {
  id: string;
  botId: string;
  conversationId: string | null;
  threadId: string | null;
  requestId: string;
  harness: string;
  text: string;
}

export function oweFinish(
  handoff: ThreadHandoff,
  finish: { requestId: string; harness: string; text: string },
): OwedFinish | undefined {
  return db.transaction((tx) => {
    const recorded = tx
      .select({ id: codeHandoffFinishes.id })
      .from(codeHandoffFinishes)
      .where(eq(codeHandoffFinishes.requestId, finish.requestId))
      .get();
    if (recorded) return undefined;
    const won = tx
      .update(codeHandoffs)
      .set({ status: "finished", finishedAt: new Date() })
      .where(
        and(
          eq(codeHandoffs.id, handoff.id),
          inArray(codeHandoffs.status, handoffMachine.sourcesOf("finished")),
        ),
      )
      .returning({ id: codeHandoffs.id })
      .all();
    if (won.length === 0) return undefined;
    const row = tx
      .insert(codeHandoffFinishes)
      .values({ handoffId: handoff.id, ...finish })
      .returning({ id: codeHandoffFinishes.id })
      .get();
    return {
      id: row.id,
      botId: handoff.botId,
      conversationId: handoff.conversationId,
      threadId: handoff.threadId,
      ...finish,
    };
  });
}

export async function owedFinishes(): Promise<OwedFinish[]> {
  return db
    .select({
      id: codeHandoffFinishes.id,
      botId: codeHandoffs.botId,
      conversationId: codeHandoffs.conversationId,
      threadId: codeHandoffs.threadId,
      requestId: codeHandoffFinishes.requestId,
      harness: codeHandoffFinishes.harness,
      text: codeHandoffFinishes.text,
    })
    .from(codeHandoffFinishes)
    .innerJoin(codeHandoffs, eq(codeHandoffs.id, codeHandoffFinishes.handoffId))
    .where(isNull(codeHandoffFinishes.deliveredAt))
    .orderBy(asc(codeHandoffFinishes.createdAt));
}

export async function markFinishDelivered(id: string): Promise<void> {
  await db
    .update(codeHandoffFinishes)
    .set({ deliveredAt: new Date() })
    .where(eq(codeHandoffFinishes.id, id));
}

export async function copyShelleyTables(instanceId = "shelley"): Promise<number> {
  const seen = await db.select().from(shelleySeen);
  const handoffs = await db.select().from(shelleyHandoffs);
  let copied = 0;
  for (const row of seen) {
    const result = await db
      .insert(codeThreads)
      .values({
        id: threadIdOf(instanceId, row.conversationId),
        instanceId,
        nativeId: row.conversationId,
        followed: true,
        seenCursor: row.lastSeenSequenceId,
        updatedAt: row.updatedAt,
      })
      .onConflictDoNothing()
      .returning({ id: codeThreads.id });
    copied += result.length;
  }
  for (const row of handoffs) {
    const result = await db
      .insert(codeHandoffs)
      .values({
        id: row.id,
        botId: row.botId,
        threadId: threadIdOf(instanceId, row.shelleyConversationId),
        title: row.slug,
        task: row.task,
        cwd: row.cwd,
        idempotencyKey: row.idempotencyKey,
        status: handoffMachine.is(row.status) ? row.status : "finished",
        createdAt: row.createdAt,
        finishedAt: row.finishedAt,
      })
      .onConflictDoNothing()
      .returning({ id: codeHandoffs.id });
    copied += result.length;
  }
  return copied;
}
