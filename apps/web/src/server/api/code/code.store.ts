/**
 * What tiny-agents keeps about Code threads (ADR 0011): the thread index
 * (`code_threads`) — followed threads and how far the owner has read them,
 * plus the rows of harnesses that keep no list of their own — and bot
 * hand-offs (`code_handoffs`) with the finishes they owe the bots
 * (`code_handoff_finishes`). Every harness keeps its own transcript.
 */
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
    // A thread started before every project thread got a title shows its branch's words.
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

/** The index drivers see (`HarnessHost.index`). */
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

// --- followed threads (unread) -------------------------------------------------

/** Follow a thread (started, opened or handed off here); keeps an existing mark. */
export async function follow(instanceId: string, nativeId: string): Promise<void> {
  const id = threadIdOf(instanceId, nativeId);
  await db
    .insert(codeThreads)
    .values({ id, instanceId, nativeId, followed: true })
    .onConflictDoUpdate({ target: codeThreads.id, set: { followed: true } });
}

/** The owner has read `threadId` up to `cursor` (never moves backwards). */
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

/** Followed threads (by thread id) and how far the owner has read each. */
export async function seenMap(): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: codeThreads.id, cursor: codeThreads.seenCursor })
    .from(codeThreads)
    .where(eq(codeThreads.followed, true));
  return new Map(rows.map((r) => [r.id, r.cursor]));
}

/** What the list adds to each thread (issue #297): its project and open pull request. */
export interface ThreadDecoration {
  projectId: string | null;
  pr: { number: number; loop: string; url: string } | null;
  /** The PR review this thread is the assistant of (issue #345). */
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

// --- hand-offs -------------------------------------------------------------------

/** A hand-off past `starting`: its thread exists. */
export type ThreadHandoff = CodeHandoff & { threadId: string };

const hasThread = (row: CodeHandoff | undefined): row is ThreadHandoff =>
  row !== undefined && row.threadId !== null;

export interface HandoffInput {
  botId: string;
  /** The conversation asking: its finish goes back there. */
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

/** A hand-off of a thread that already exists (an adopted one): `running` at once. */
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

/**
 * Claim a start for its idempotency key before the harness makes the thread
 * (`starting`, no thread yet): true for the caller that won. A key already
 * claimed, by this start or an earlier run of it, makes no second thread.
 */
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

/** starting → running, with the thread the harness made. */
export async function startedHandoff(key: string, threadId: string): Promise<ThreadHandoff> {
  await db
    .update(codeHandoffs)
    .set({ threadId, status: "running" })
    .where(and(eq(codeHandoffs.idempotencyKey, key), eq(codeHandoffs.status, "starting")));
  const row = await findHandoffByKey(key);
  if (!hasThread(row)) throw new Error("hand-off row missing after start");
  return row;
}

/** Drop a claim whose thread was never made (the harness refused), so nothing waits on it. */
export async function dropHandoffClaim(key: string): Promise<void> {
  await db
    .delete(codeHandoffs)
    .where(and(eq(codeHandoffs.idempotencyKey, key), eq(codeHandoffs.status, "starting")));
}

/** Forget an adopted hand-off whose first send failed (nothing ran for it). */
export async function forgetHandoff(id: string): Promise<void> {
  await db
    .delete(codeHandoffs)
    .where(and(eq(codeHandoffs.id, id), eq(codeHandoffs.status, "running")));
}

/** A bot's hand-offs, newest first (optionally to one harness instance). */
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

/**
 * Mark a hand-off running again (the bot sent a follow-up), so its next
 * finish is delivered. A hand-off still running is left as it is.
 * `finishedAt` becomes the reopen time, so a reconnect before the new turn
 * starts never owes the turn that ended before it again (`endsHandoff`).
 */
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

/**
 * A follow-up from `conversationId`: the hand-off's next finish goes there.
 * Returns the conversation it replaced, to put back if the send fails.
 */
export async function askedFrom(id: string, conversationId: string): Promise<string | null> {
  const row = await db.query.codeHandoffs.findFirst({
    where: eq(codeHandoffs.id, id),
    columns: { conversationId: true },
  });
  await db.update(codeHandoffs).set({ conversationId }).where(eq(codeHandoffs.id, id));
  return row?.conversationId ?? null;
}

/**
 * Whether a turn that ended at `endedAt` (harness time, ms) is this running
 * hand-off's to report: it ended after the hand-off started or, once a
 * follow-up reopened it, after the reopen.
 */
export function endsHandoff(handoff: CodeHandoff, endedAt: number): boolean {
  return handoff.finishedAt
    ? endedAt > handoff.finishedAt.getTime()
    : endedAt >= handoff.createdAt.getTime();
}

/** Running hand-offs of these threads (all when omitted). */
export async function runningHandoffs(threadIds?: string[]): Promise<ThreadHandoff[]> {
  const running = eq(codeHandoffs.status, "running");
  const rows = await db
    .select()
    .from(codeHandoffs)
    .where(threadIds ? and(running, inArray(codeHandoffs.threadId, threadIds)) : running);
  return rows.filter(hasThread);
}

/** running → finished, once, owing nothing: true for the caller that won (a reopen undone). */
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

/** A finish owed to a bot, with what its delivery needs. */
export interface OwedFinish {
  id: string;
  botId: string;
  /** Where it goes (`deliverHandoffFinish`); null: the bot's chat. */
  conversationId: string | null;
  threadId: string | null;
  requestId: string;
  harness: string;
  text: string;
}

/**
 * The turn ended: running → finished, once, and the finish it owes the bot
 * written in the same transaction, so a crash before the delivery leaves it
 * owed rather than lost. Returns the owed finish for the caller that won.
 * A turn whose finish is already recorded (the same outcome read again, as
 * after a follow-up reopened the hand-off) finishes nothing.
 */
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

/** Finishes not yet delivered, oldest first (boot, reconnects, retries). */
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

/** The submit returned: the finish is delivered. */
export async function markFinishDelivered(id: string): Promise<void> {
  await db
    .update(codeHandoffFinishes)
    .set({ deliveredAt: new Date() })
    .where(eq(codeHandoffFinishes.id, id));
}

// --- the Shelley-only tables before ADR 0011 -------------------------------------

/**
 * Copy `shelley_seen` and `shelley_handoffs` (issue #143) into the Code
 * tables once, under the `shelley` instance. Idempotent: rows already
 * copied are skipped, so it runs on every boot. The old tables stay until a
 * later release drops them.
 */
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
        // The legacy column is untyped text: anything unknown has finished.
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
