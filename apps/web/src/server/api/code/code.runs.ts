import { and, desc, eq, inArray } from "drizzle-orm";
import { codeCheckpoints, codeRuns, db, type CodeRunRow } from "../../db";
import { runMachine, type RunStatus } from "../../../shared/machines/run";

export interface RunTrigger {
  trigger: "owner" | "workflow" | "bot";
  workflow?: string;
  event?: Record<string, unknown>;
}

const OPEN: RunStatus[] = ["running", "stopping"];

async function openRunOf(threadId: string): Promise<CodeRunRow | undefined> {
  const [row] = await db
    .select()
    .from(codeRuns)
    .where(and(eq(codeRuns.threadId, threadId), inArray(codeRuns.status, OPEN)))
    .orderBy(codeRuns.seq)
    .limit(1);
  return row;
}

async function nextSeq(threadId: string): Promise<number> {
  const [last] = await db
    .select({ seq: codeRuns.seq })
    .from(codeRuns)
    .where(eq(codeRuns.threadId, threadId))
    .orderBy(desc(codeRuns.seq))
    .limit(1);
  return (last?.seq ?? 0) + 1;
}

async function latestCheckpoint(threadId: string): Promise<number | null> {
  const [last] = await db
    .select({ seq: codeCheckpoints.seq })
    .from(codeCheckpoints)
    .where(eq(codeCheckpoints.threadId, threadId))
    .orderBy(desc(codeCheckpoints.seq))
    .limit(1);
  return last?.seq ?? null;
}

export async function startRun(threadId: string, input: RunTrigger): Promise<CodeRunRow> {
  const open = await openRunOf(threadId);
  if (open && input.trigger !== "workflow") return open;
  const [row] = await db
    .insert(codeRuns)
    .values({
      threadId,
      seq: await nextSeq(threadId),
      trigger: input.trigger,
      workflow: input.workflow ?? null,
      event: JSON.stringify(input.event ?? {}),
      status: "running",
      checkpointSeq: await latestCheckpoint(threadId),
    })
    .returning();
  return row!;
}

export async function stopRun(threadId: string): Promise<void> {
  await db
    .update(codeRuns)
    .set({ status: "stopping" })
    .where(
      and(
        eq(codeRuns.threadId, threadId),
        inArray(codeRuns.status, runMachine.sourcesOf("stopping")),
      ),
    );
}

export async function endRun(
  threadId: string,
  outcome: { failed: boolean; endedAt?: Date; costUsd?: number },
): Promise<CodeRunRow> {
  const endedAt = outcome.endedAt ?? new Date();
  const open = await openRunOf(threadId);
  if (!open) {
    const [row] = await db
      .insert(codeRuns)
      .values({
        threadId,
        seq: await nextSeq(threadId),
        trigger: "owner",
        status: outcome.failed ? "failed" : "done",
        checkpointSeq: null,
        endedAt,
      })
      .returning();
    return row!;
  }
  const status: RunStatus = outcome.failed
    ? "failed"
    : open.status === "stopping"
      ? "stopped"
      : "done";
  const [row] = await db
    .update(codeRuns)
    .set({
      status,
      endedAt,
      ...(outcome.costUsd === undefined ? {} : { costUsd: outcome.costUsd }),
    })
    .where(and(eq(codeRuns.id, open.id), inArray(codeRuns.status, runMachine.sourcesOf(status))))
    .returning();
  return row ?? open;
}

export async function runsOf(threadId: string): Promise<CodeRunRow[]> {
  return db.select().from(codeRuns).where(eq(codeRuns.threadId, threadId)).orderBy(codeRuns.seq);
}
