import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { createId } from "@groot/core/utils/id.utils";
import {
  parseThreadId,
  threadIdOf,
  type InstanceEvent,
  type ThreadEvent,
  type ThreadSnapshot,
  type ThreadSummary,
  type TranscriptItem,
} from "@tiny-agents/code/server";
import {
  bots,
  codeHandoffs,
  codePullRequests,
  codeReviews,
  codeRuns,
  codeThreads,
  db,
  type CodeThreadRow,
} from "../../db";
import { threadStatus } from "../../../shared/code-status";
import type { RunStatus } from "../../../shared/machines/run";
import { endRun } from "./code.runs";

export interface ThreadRef {
  instanceId: string;
  nativeId: string;
}

export function threadRef(id: string): ThreadRef | undefined {
  const row = db
    .select({ instanceId: codeThreads.instanceId, nativeId: codeThreads.nativeId })
    .from(codeThreads)
    .where(eq(codeThreads.id, id))
    .get();
  return row ?? parseThreadId(id);
}

export function threadKey(instanceId: string, nativeId: string): string {
  const row = db
    .select({ id: codeThreads.id })
    .from(codeThreads)
    .where(and(eq(codeThreads.instanceId, instanceId), eq(codeThreads.nativeId, nativeId)))
    .get();
  return row?.id ?? threadIdOf(instanceId, nativeId);
}

export async function ensureThread(
  instanceId: string,
  nativeId: string,
  set: Partial<typeof codeThreads.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(codeThreads)
    .values({ id: createId(), instanceId, nativeId, ...set })
    .onConflictDoUpdate({
      target: [codeThreads.instanceId, codeThreads.nativeId],
      set: { instanceId, ...set },
    })
    .returning({ id: codeThreads.id });
  return row!.id;
}

export async function repointThread(id: string, nativeId: string): Promise<void> {
  await db
    .update(codeThreads)
    .set({ nativeId, updatedAt: new Date() })
    .where(eq(codeThreads.id, id));
}

export async function setAttention(id: string, attention: string | null): Promise<boolean> {
  const changed = await db
    .update(codeThreads)
    .set({ attention })
    .where(eq(codeThreads.id, id))
    .returning({ id: codeThreads.id });
  return changed.length > 0;
}

interface Decoration {
  pull: { number: number; loop: string; url: string } | null;
  review: { id: string; number: number } | null;
  lastRun: { status: RunStatus; workflow: string | null } | null;
  startedBy: ThreadSummary["startedBy"];
}

async function decorations(): Promise<Map<string, Decoration>> {
  const [pulls, reviews, runs, starters] = await Promise.all([
    db
      .select({
        threadId: codePullRequests.threadId,
        number: codePullRequests.number,
        url: codePullRequests.url,
        loop: codePullRequests.loopStatus,
        state: codePullRequests.state,
      })
      .from(codePullRequests)
      .orderBy(desc(codePullRequests.createdAt)),
    db
      .select({ id: codeReviews.id, number: codeReviews.number, threadId: codeReviews.threadId })
      .from(codeReviews)
      .where(isNotNull(codeReviews.threadId)),
    db
      .select({
        threadId: codeRuns.threadId,
        status: codeRuns.status,
        workflow: codeRuns.workflow,
      })
      .from(codeRuns)
      .orderBy(desc(codeRuns.seq)),
    db
      .select({
        threadId: codeHandoffs.threadId,
        botId: bots.id,
        name: bots.name,
        projectId: bots.projectId,
      })
      .from(codeHandoffs)
      .innerJoin(bots, eq(bots.id, codeHandoffs.botId))
      .where(isNotNull(codeHandoffs.threadId))
      .orderBy(asc(codeHandoffs.createdAt)),
  ]);
  const out = new Map<string, Decoration>();
  const entry = (id: string) => {
    const found = out.get(id) ?? { pull: null, review: null, lastRun: null, startedBy: null };
    out.set(id, found);
    return found;
  };
  for (const pull of pulls) {
    const found = entry(pull.threadId);
    if (found.pull && found.pull.loop !== "merged") continue;
    if (pull.state === "open") found.pull = { number: pull.number, loop: pull.loop, url: pull.url };
    else if (pull.state === "merged" && !found.pull) {
      found.pull = { number: pull.number, loop: "merged", url: pull.url };
    }
  }
  for (const review of reviews) {
    entry(review.threadId!).review = { id: review.id, number: review.number };
  }
  for (const run of runs) {
    const found = entry(run.threadId);
    found.lastRun ??= { status: run.status, workflow: run.workflow };
  }
  for (const starter of starters) {
    const found = entry(starter.threadId!);
    found.startedBy ??= {
      botId: starter.botId,
      name: starter.name,
      project: starter.projectId !== null,
    };
  }
  return out;
}

function summaryOf(
  row: CodeThreadRow,
  live: ThreadSummary | undefined,
  kind: string,
  extra: Decoration | undefined,
): ThreadSummary {
  const working = live?.working ?? false;
  const cursor = live?.cursor ?? row.seenCursor;
  const unread = !working && cursor > row.seenCursor;
  const pull = extra?.pull ?? null;
  return {
    ...(live ?? {
      instanceId: row.instanceId,
      kind,
      nativeId: row.nativeId,
      title: row.title,
      cwd: row.cwd,
      model: row.model,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      working: false,
      archived: row.archived,
      cursor,
    }),
    id: row.id,
    parentId: null,
    title: live?.title || row.title,
    cwd: row.worktree ?? live?.cwd ?? row.cwd,
    followed: true,
    unread,
    projectId: row.projectId,
    branch: row.branch,
    role: row.role,
    pr: pull && pull.loop !== "merged" ? pull : null,
    review: extra?.review ?? null,
    offline: live === undefined,
    startedBy: extra?.startedBy ?? null,
    status: threadStatus({
      working,
      attention: row.attention,
      unread,
      lastRun: extra?.lastRun ?? null,
      pull,
    }),
  };
}

export interface HarnessLists {
  kindOf(instanceId: string): string | undefined;
  active(instanceId: string): ThreadSummary[] | undefined;
}

export async function listProjectThreads(lists: HarnessLists): Promise<ThreadSummary[]> {
  const [rows, extras] = await Promise.all([
    db
      .select()
      .from(codeThreads)
      .where(isNotNull(codeThreads.projectId))
      .orderBy(desc(codeThreads.updatedAt)),
    decorations(),
  ]);
  const out: ThreadSummary[] = [];
  for (const row of rows) {
    const kind = lists.kindOf(row.instanceId);
    if (kind === undefined) continue;
    const active = lists.active(row.instanceId);
    const live = active?.find((thread) => thread.nativeId === row.nativeId);
    if (row.archived || (active && !live)) continue;
    out.push(summaryOf(row, live, kind, extras.get(row.id)));
  }
  return out;
}

export async function decorateThreads(rows: ThreadSummary[]): Promise<ThreadSummary[]> {
  const extras = await decorations();
  const out: ThreadSummary[] = [];
  for (const live of rows) {
    const [row] = await db
      .select()
      .from(codeThreads)
      .where(
        and(eq(codeThreads.instanceId, live.instanceId), eq(codeThreads.nativeId, live.nativeId)),
      );
    if (row?.projectId) out.push(summaryOf(row, live, live.kind, extras.get(row.id)));
  }
  return out;
}

function keyOfSummary(thread: ThreadSummary): ThreadSummary {
  const id = threadKey(thread.instanceId, thread.nativeId);
  const project = db
    .select({ projectId: codeThreads.projectId, branch: codeThreads.branch })
    .from(codeThreads)
    .where(eq(codeThreads.id, id))
    .get();
  return {
    ...thread,
    id,
    parentId: thread.parentId ? appId(thread.parentId) : null,
    ...(project?.projectId ? { projectId: project.projectId, branch: project.branch } : {}),
  };
}

function appId(harnessThreadId: string): string {
  const parsed = parseThreadId(harnessThreadId);
  return parsed ? threadKey(parsed.instanceId, parsed.nativeId) : harnessThreadId;
}

const keyOfItem = (item: TranscriptItem): TranscriptItem =>
  item.kind === "tool" && item.child
    ? { ...item, child: { ...item.child, threadId: appId(item.child.threadId) } }
    : item;

export function withThreadKeys(snapshot: ThreadSnapshot): ThreadSnapshot {
  return {
    ...snapshot,
    thread: keyOfSummary(snapshot.thread),
    children: snapshot.children.map(keyOfSummary),
    items: snapshot.items.map(keyOfItem),
  };
}

export function eventWithThreadKeys(event: ThreadEvent): ThreadEvent {
  if (event.type === "snapshot") return { ...event, snapshot: withThreadKeys(event.snapshot) };
  if (event.type === "thread") return { ...event, thread: keyOfSummary(event.thread) };
  if (event.type === "items") return { ...event, items: event.items.map(keyOfItem) };
  return event;
}

export async function recordThreadEvent(
  instanceId: string,
  event: InstanceEvent,
): Promise<boolean> {
  if (event.type === "attention") {
    return setAttention(threadKey(instanceId, event.nativeId), event.text);
  }
  if (event.type !== "turn_ended" || event.outcome.working) return false;
  const id = threadKey(instanceId, event.nativeId);
  if (!(await setAttention(id, null))) return false;
  await endRun(id, {
    failed: event.outcome.failed,
    ...(event.outcome.endedAt ? { endedAt: new Date(event.outcome.endedAt) } : {}),
  });
  return true;
}
