/**
 * Boot re-arm (the move off the old job queue): every enabled routine with a
 * `nextRunAt` but no live routine-fire job gets its occurrence queued again.
 * The first boot after the database copy has every handle cleared
 * (db/legacy-copy.ts); a job that failed for good leaves one pointing at a
 * dead job. An overdue occurrence meets the grace policy when the tick runs
 * it, as a delivery delayed by downtime did. Real SQLite test DB and queue
 * table; the tests drive the queue with `runTick()` (no worker runs).
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { addJob } from "@groot/jobs/server/queue";
import { runTick } from "@groot/jobs/server/tick";
import { jobRunner } from "@groot/jobs/server/tick";
import { db, jobs, routineRuns, routines } from "../../../../apps/web/src/server/db";
import {
  ROUTINE_FIRE_JOB,
  rearmRoutines,
} from "../../../../apps/web/src/server/api/routines/routines.arming";
import { registerRoutineJobs } from "../../../../apps/web/src/server/api/routines/routines.jobs";
import { runRequestId } from "../../../../apps/web/src/server/api/routines/routines.runs";
import { routineRunsStep } from "../../../../apps/web/src/server/api/routines/routines.watcher";
import type { AgentRuntime } from "../../../../packages/agent/src/index";
import {
  closeAppRuntime,
  openAppRuntime,
  resetAppTables,
  seedBot,
  spyOnRuntime,
  type SpiedRuntime,
} from "../../fixtures";

const MINUTE = 60_000;
let botId = "";

/** A routine as the database copy leaves it: armed, slot set, no live job. */
async function seedArmed(
  schedule: unknown,
  nextRunAt: Date | null,
  extra: { enabled?: boolean; pendingJobId?: string | null; name?: string } = {},
) {
  const [routine] = await db
    .insert(routines)
    .values({
      botId,
      name: extra.name ?? "digest",
      prompt: "Do the thing.",
      schedule,
      enabled: extra.enabled ?? true,
      nextRunAt,
      pendingJobId: extra.pendingJobId ?? null,
    })
    .returning();
  return routine!;
}

async function routineRow(id: string) {
  return (await db.query.routines.findFirst({ where: eq(routines.id, id) }))!;
}

async function fireJobs() {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.name, ROUTINE_FIRE_JOB))
    .orderBy(sql`rowid`);
}

async function jobById(id: string) {
  return (await db.select().from(jobs).where(eq(jobs.id, id)))[0];
}

const clearTables = resetAppTables;

/** The conversation a routine runs in, once its first fire created it. */
async function routineConversation(id: string): Promise<number> {
  return Number((await routineRow(id)).conversationId);
}

describe("re-arming routines on boot", () => {
  let rt: AgentRuntime;
  let runtime: SpiedRuntime;

  beforeEach(async () => {
    vi.clearAllMocks();
    jobRunner.reset();
    registerRoutineJobs();
    rt = await openAppRuntime();
    runtime = spyOnRuntime(rt);
    await clearTables();
    botId = (await seedBot({ name: "Bot" })).id;
  });

  afterEach(async () => {
    jobRunner.reset();
    await clearTables();
    await closeAppRuntime();
  });

  it("queues a copied routine's next occurrence at its time", async () => {
    const now = new Date();
    const slot = new Date(now.getTime() + 2 * 60 * MINUTE);
    const routine = await seedArmed({ kind: "interval", minutes: 60 }, slot);

    expect(await rearmRoutines(now)).toBe(1);

    const [job] = await fireJobs();
    expect(job).toMatchObject({ state: "created" });
    expect(job!.data).toEqual({
      routineId: routine.id,
      scheduledFor: slot.toISOString(),
      trigger: "schedule",
    });
    // Due at the slot (rounded up to the second), not before.
    expect(job!.runAt.getTime()).toBeGreaterThanOrEqual(slot.getTime());
    expect(job!.runAt.getTime()).toBeLessThan(slot.getTime() + 2_000);
    const row = await routineRow(routine.id);
    expect(row.pendingJobId).toBe(job!.id);
    expect(row.nextRunAt?.toISOString()).toBe(slot.toISOString());
    // Not due yet: a tick leaves it waiting and submits nothing.
    await runTick();
    expect((await jobById(job!.id))?.state).toBe("created");
    expect(runtime.submit).not.toHaveBeenCalled();
  });

  it("leaves live jobs alone, replaces dead ones, and skips what is not armed", async () => {
    const slot = new Date(Date.now() + 60 * MINUTE);
    const schedule = { kind: "interval", minutes: 60 };
    const liveJob = await addJob(
      ROUTINE_FIRE_JOB,
      { routineId: "x", scheduledFor: slot.toISOString(), trigger: "schedule" },
      { delaySeconds: 3600 },
    );
    const finishedJob = await addJob(ROUTINE_FIRE_JOB, {}, { delaySeconds: 3600 });
    await db.update(jobs).set({ state: "completed" }).where(eq(jobs.id, finishedJob));

    const live = await seedArmed(schedule, slot, { pendingJobId: liveJob, name: "live" });
    const finished = await seedArmed(schedule, slot, { pendingJobId: finishedJob, name: "done" });
    const purged = await seedArmed(schedule, slot, { pendingJobId: "gone-job", name: "purged" });
    const paused = await seedArmed(schedule, null, { enabled: false, name: "paused" });
    const unslotted = await seedArmed(schedule, null, { name: "unslotted" });

    expect(await rearmRoutines()).toBe(2);

    expect((await routineRow(live.id)).pendingJobId).toBe(liveJob);
    for (const id of [finished.id, purged.id]) {
      const row = await routineRow(id);
      expect(row.pendingJobId).not.toBe(finishedJob);
      expect(row.pendingJobId).not.toBe("gone-job");
      expect((await jobById(row.pendingJobId!))?.state).toBe("created");
    }
    expect(await routineRow(paused.id)).toMatchObject({ pendingJobId: null, nextRunAt: null });
    expect(await routineRow(unslotted.id)).toMatchObject({ pendingJobId: null, nextRunAt: null });

    // Idempotent: a second boot finds every armed routine with a live job.
    const count = (await fireJobs()).length;
    expect(await rearmRoutines()).toBe(0);
    expect(await fireJobs()).toHaveLength(count);
  });

  it("an occurrence missed during the downtime but within grace fires late", async () => {
    // Hourly: grace is 30 minutes, the slot was 10 minutes ago.
    const slot = new Date(Date.now() - 10 * MINUTE);
    const routine = await seedArmed({ kind: "interval", minutes: 60 }, slot);

    expect(await rearmRoutines()).toBe(1);
    expect(await runTick()).toMatchObject({ claimed: 1, completed: 1 });

    const run = await db.query.routineRuns.findFirst({
      where: eq(routineRuns.routineId, routine.id),
    });
    expect(run).toMatchObject({
      status: "awaiting",
      requestId: runRequestId(routine.id, slot),
    });
    const submits = runtime.submit.mock.calls;
    expect(submits).toHaveLength(1);
    expect(submits[0]![0]).toBe(await routineConversation(routine.id));
    expect(submits[0]![1].text).toContain("(late by 10m)");
    // The chain keeps its phase: the next slot is an hour after the late one.
    const row = await routineRow(routine.id);
    expect(row.nextRunAt?.toISOString()).toBe(new Date(slot.getTime() + 60 * MINUTE).toISOString());
    expect((await jobById(row.pendingJobId!))?.state).toBe("created");
  });

  it("an occurrence past its grace is recorded missed and the chain resumes from now", async () => {
    const slot = new Date(Date.now() - 2 * 60 * MINUTE);
    const routine = await seedArmed({ kind: "interval", minutes: 60 }, slot);

    expect(await rearmRoutines()).toBe(1);
    const before = Date.now();
    await runTick();

    const run = await db.query.routineRuns.findFirst({
      where: eq(routineRuns.routineId, routine.id),
    });
    expect(run).toMatchObject({ status: "missed", requestId: runRequestId(routine.id, slot) });
    expect(runtime.submit).not.toHaveBeenCalled();
    const row = await routineRow(routine.id);
    expect(row.enabled).toBe(true);
    expect(row.nextRunAt!.getTime()).toBeGreaterThan(before);
  });

  it("a one-time routine whose moment passed during the downtime still fires", async () => {
    const at = new Date(Date.now() - 3 * 60 * MINUTE);
    const routine = await seedArmed({ kind: "once", at: at.toISOString() }, at);

    expect(await rearmRoutines()).toBe(1);
    await runTick();

    expect(runtime.submit).toHaveBeenCalledTimes(1);
    expect(runtime.submit.mock.calls[0]![1].text).toContain("(late by 3h)");
    // Fired once: archived.
    expect(await routineRow(routine.id)).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pendingJobId: null,
    });
  });

  it("an occurrence already submitted is not fired again: the chain advances", async () => {
    const slot = new Date(Date.now() - 5 * MINUTE);
    const routine = await seedArmed({ kind: "interval", minutes: 60 }, slot);
    await db.insert(routineRuns).values({
      routineId: routine.id,
      scheduledFor: slot,
      status: "awaiting",
      requestId: runRequestId(routine.id, slot),
      submittedAt: slot,
    });

    expect(await rearmRoutines()).toBe(1);
    await runTick();

    expect(runtime.submit).not.toHaveBeenCalled();
    const row = await routineRow(routine.id);
    expect(row.nextRunAt?.toISOString()).toBe(new Date(slot.getTime() + 60 * MINUTE).toISOString());
    const job = await jobById(row.pendingJobId!);
    expect(job).toMatchObject({ state: "created" });
    expect(job!.data).toMatchObject({ scheduledFor: row.nextRunAt!.toISOString() });
  });

  it("the boot path re-arms: the routine runs step's sweep queues the missing jobs", async () => {
    const slot = new Date(Date.now() + 30 * MINUTE);
    const routine = await seedArmed({ kind: "interval", minutes: 60 }, slot);

    await routineRunsStep(rt).sweep?.();

    await vi.waitFor(async () => {
      expect((await routineRow(routine.id)).pendingJobId).toBeTypeOf("string");
    });
    expect(await fireJobs()).toHaveLength(1);
  });
});
