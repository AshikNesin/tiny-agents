/**
 * Routines REST API over the real SQLite test DB: CRUD, pause cancels the
 * queued job, run-now submits a manual occurrence, resume recomputes, and
 * validation errors are 400s. The agent runtime is a fake (bots.routes
 * pattern); the queue is the real `jobs` table (no worker runs in tests), so
 * assertions see exactly which queue jobs live or die.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { bots, db, jobs, routineRuns, routines } from "../../../apps/web/src/server/db";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";
import { ROUTINE_FIRE_JOB } from "../../../apps/web/src/server/api/routines/routines.jobs";
import type { AgentRuntime } from "@tiny-agents/agent";
import { api, createTestApp, type TestApp } from "../helpers";

const token = await generateToken({ userId: 1, email: "routines-test@example.com" });

type Routine = Record<string, unknown> & { id: string; botId: string };

/** Routine-fire jobs on the queue table, oldest first. */
async function fireJobs() {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.name, ROUTINE_FIRE_JOB))
    .orderBy(sql`rowid`);
}

/** Jobs still waiting to fire. */
async function queuedJobs() {
  return (await fireJobs()).filter((job) => job.state === "created");
}

async function cancelledJobIds() {
  return (await fireJobs()).filter((job) => job.state === "cancelled").map((job) => job.id);
}

async function routineRow(id: string) {
  return db.query.routines.findFirst({ where: eq(routines.id, id) });
}

const emptyChat = { messages: [], busy: false };

function fakeRuntime(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    // A routine's own conversation (issue #63); the bot's chat is 100.
    createConversation: vi.fn().mockResolvedValue(200),
    configure: vi.fn().mockResolvedValue(undefined),
    submit: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    watchChat: vi.fn(async (_ref: number, listener: (events: unknown[]) => void) => {
      await listener([{ type: "snapshot", state: emptyChat }]);
      return { initial: emptyChat, stop: async () => undefined };
    }),
    isBusy: vi.fn().mockReturnValue(false),
    busyConversations: vi.fn().mockReturnValue([]),
    onActivity: vi.fn().mockReturnValue(() => undefined),
    listModels: vi
      .fn()
      .mockReturnValue([
        { id: "m1", name: "M1", family: "other", reasoning: false, contextWindow: 8192 },
      ]),
    hasModel: vi.fn().mockReturnValue(true),
    listCapabilities: vi.fn().mockReturnValue([]),
    pendingApprovals: vi.fn().mockReturnValue(0),
    decideApproval: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AgentRuntime;
}

async function seedBot(): Promise<string> {
  const [bot] = await db
    .insert(bots)
    .values({ name: "Helper", modelId: "m1", conversationId: "100" })
    .returning();
  return bot!.id;
}

const cronPayload = {
  botId: "",
  name: "weekday-digest",
  prompt: "Summarize HN, only new things.",
  schedule: { kind: "cron", expr: "0 9 * * 1-5" },
};

async function createRoutine(app: TestApp, overrides: Record<string, unknown> = {}) {
  const botId = await seedBot();
  const response = await api<Routine>(app, "/api/v1/routines", {
    method: "POST",
    json: { ...cronPayload, botId, ...overrides },
    token,
  });
  expect(response.status).toBe(201);
  return response.body.data!;
}

async function clearTables() {
  await db.delete(routineRuns);
  await db.delete(routines);
  await db.delete(bots);
  await db.delete(jobs);
}

describe("Routines API routes", () => {
  let app: TestApp;

  beforeEach(async () => {
    vi.clearAllMocks();
    setAgentRuntimeForTests(fakeRuntime());
    app = createTestApp();
    await clearTables();
  });

  afterEach(clearTables);

  it("requires authentication", async () => {
    const response = await api(app, "/api/v1/routines");
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false });
  });

  it("creates an armed routine and queues its first delayed job", async () => {
    const routine = await createRoutine(app);
    expect(routine).toMatchObject({
      name: "weekday-digest",
      enabled: true,
      scheduleDescription: expect.stringContaining("Monday through Friday"),
    });
    expect(Array.isArray(routine.nextFireTimes)).toBe(true);
    expect(routine.nextFireTimes).toHaveLength(3);
    const queued = await fireJobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ name: ROUTINE_FIRE_JOB, state: "created" });
    expect(queued[0]!.data).toMatchObject({ routineId: routine.id, trigger: "schedule" });
    // Delayed until the slot (the worker would not claim it yet).
    expect(queued[0]!.runAt.getTime()).toBeGreaterThan(Date.now());
    const row = await routineRow(routine.id);
    expect(row?.pendingJobId).toBe(queued[0]!.id);
    expect(row?.nextRunAt).toBeInstanceOf(Date);
  });

  it("creates a disabled routine without queueing", async () => {
    const routine = await createRoutine(app, { enabled: false });
    expect(routine.enabled).toBe(false);
    expect(await fireJobs()).toHaveLength(0);
    const row = await routineRow(routine.id);
    expect(row?.pendingJobId).toBeNull();
    expect(row?.nextRunAt).toBeNull();
  });

  it("lists routines with next run and description", async () => {
    await createRoutine(app);
    const response = await api<Record<string, unknown>[]>(app, "/api/v1/routines", { token });
    expect(response.status).toBe(200);
    const list = response.body.data!;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "weekday-digest", botName: "Helper" });
    expect(list[0]!.nextRunAt).toBeTruthy();
  });

  it("rejects invalid schedules with 400", async () => {
    const botId = await seedBot();
    const cases = [
      { schedule: { kind: "interval", minutes: 5 } },
      { schedule: { kind: "cron", expr: "garbage" } },
      { schedule: { kind: "cron", expr: "0 30 9 * * *" } },
      { schedule: { kind: "once", at: "2026-11-01T09:00:00" } },
      { prompt: "" },
      { name: "x".repeat(81) },
      { botId: "does-not-exist" },
    ];
    for (const overrides of cases) {
      const response = await api(app, "/api/v1/routines", {
        method: "POST",
        json: { ...cronPayload, botId, ...overrides },
        token,
      });
      expect(response.status).toBe(400);
    }
    expect(await fireJobs()).toHaveLength(0);
  });

  it("patches name without touching the queue, and a schedule change re-arms", async () => {
    const routine = await createRoutine(app);
    const firstJobId = (await routineRow(routine.id))?.pendingJobId as string;

    const renamed = await api<Routine>(app, `/api/v1/routines/${routine.id}`, {
      method: "PATCH",
      json: { name: "renamed" },
      token,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data!.name).toBe("renamed");
    // Name-only edits keep the pending job.
    expect((await queuedJobs()).map((job) => job.id)).toEqual([firstJobId]);

    const rescheduled = await api<Routine>(app, `/api/v1/routines/${routine.id}`, {
      method: "PATCH",
      json: { schedule: { kind: "interval", minutes: 30 } },
      token,
    });
    expect(rescheduled.status).toBe(200);
    expect(rescheduled.body.data!.scheduleDescription).toBe("Every 30 minutes");
    expect(await cancelledJobIds()).toContain(firstJobId);
    const queued = await queuedJobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.data).toMatchObject({ routineId: routine.id, trigger: "schedule" });
  });

  it("a schedule edit on a paused routine stays paused", async () => {
    const routine = await createRoutine(app);
    const paused = await api(app, `/api/v1/routines/${routine.id}/pause`, {
      method: "POST",
      token,
    });
    expect(paused.status).toBe(200);
    const jobsBefore = (await fireJobs()).length;

    const edited = await api<Routine>(app, `/api/v1/routines/${routine.id}`, {
      method: "PATCH",
      json: { schedule: { kind: "interval", minutes: 45 } },
      token,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data!.enabled).toBe(false);
    // Paused stays paused despite the new schedule.
    expect(await fireJobs()).toHaveLength(jobsBefore);
    expect(await queuedJobs()).toHaveLength(0);
  });

  it("pause cancels the pending job and clears the slot; resume re-arms from now", async () => {
    const routine = await createRoutine(app);
    const firstJobId = (await routineRow(routine.id))?.pendingJobId as string;

    const paused = await api<Routine>(app, `/api/v1/routines/${routine.id}/pause`, {
      method: "POST",
      token,
    });
    expect(paused.status).toBe(200);
    expect(paused.body.data!.enabled).toBe(false);
    expect(await cancelledJobIds()).toEqual([firstJobId]);
    const pausedRow = await routineRow(routine.id);
    expect(pausedRow?.pendingJobId).toBeNull();
    expect(pausedRow?.nextRunAt).toBeNull();

    const resumed = await api<Routine>(app, `/api/v1/routines/${routine.id}/resume`, {
      method: "POST",
      token,
    });
    expect(resumed.status).toBe(200);
    expect(resumed.body.data!.enabled).toBe(true);
    const queued = await queuedJobs();
    expect(queued).toHaveLength(1);
    const row = await routineRow(routine.id);
    expect(row?.pendingJobId).toBe(queued[0]!.id);
    expect(row?.pendingJobId).not.toBe(firstJobId);
    expect(row?.nextRunAt).toBeInstanceOf(Date);
  });

  it("deleting cancels the pending job and cascades runs", async () => {
    const routine = await createRoutine(app);
    const id = routine.id;
    const pendingJobId = (await routineRow(id))?.pendingJobId;
    const deleted = await api(app, `/api/v1/routines/${id}`, { method: "DELETE", token });
    expect(deleted.status).toBe(200);
    expect(await cancelledJobIds()).toEqual([pendingJobId]);
    expect(await routineRow(id)).toBeUndefined();
    expect(await db.$count(routineRuns)).toBe(0);
  });

  it("run-now submits a manual occurrence without archiving a future once routine", async () => {
    const runtime = fakeRuntime();
    setAgentRuntimeForTests(runtime);
    const routine = await createRoutine(app, {
      schedule: { kind: "once", at: "2026-11-01T09:00:00+05:30" },
    });
    const jobsBefore = (await fireJobs()).length;

    const response = await api<{ runId: string }>(app, `/api/v1/routines/${routine.id}/run`, {
      method: "POST",
      token,
    });
    expect(response.status).toBe(200);
    const runId = response.body.data!.runId;
    expect(runId).toBeTruthy();

    const run = await db.query.routineRuns.findFirst({ where: eq(routineRuns.id, runId) });
    expect(run).toMatchObject({ status: "awaiting", trigger: "manual" });
    expect(run?.requestId).toMatch(/^routine:[a-z0-9]+:\d{4}-\d{2}-\d{2}T/);

    // Into the routine's own conversation, never the bot's chat (100).
    const submits = vi.mocked(runtime.submit).mock.calls;
    expect(submits).toHaveLength(1);
    expect(submits[0]![0]).toBe(200);
    expect(submits[0]![1].requestId).toBe(run?.requestId);
    expect(submits[0]![1].text).toContain('**Routine "weekday-digest"');
    expect(submits[0]![1].text).toContain("Summarize HN, only new things.");
    // The scheduled occurrence is still pending, so a manual run leaves the
    // chain armed (only the scheduled fire archives a once routine).
    const row = await routineRow(routine.id);
    expect(row?.enabled).toBe(true);
    expect(row?.pendingJobId).toBeTypeOf("string");
    expect(await fireJobs()).toHaveLength(jobsBefore);
  });

  it("moving a routine to another bot gives it a fresh conversation for that bot", async () => {
    const runtime = fakeRuntime();
    setAgentRuntimeForTests(runtime);
    const routine = await createRoutine(app);
    const id = routine.id;
    expect((await api(app, `/api/v1/routines/${id}/run`, { method: "POST", token })).status).toBe(
      200,
    );
    expect((await routineRow(id))?.conversationId).toBe("200");

    const [other] = await db
      .insert(bots)
      .values({ name: "Other", modelId: "m1", conversationId: "101" })
      .returning();
    const moved = await api(app, `/api/v1/routines/${id}`, {
      method: "PATCH",
      json: { botId: other!.id },
      token,
    });
    expect(moved.status).toBe(200);
    expect((await routineRow(id))?.conversationId).toBeNull();
    expect(vi.mocked(runtime.abort)).toHaveBeenCalledWith(200);
    // The run awaiting in the old conversation never gets its reply now.
    expect(
      await db.query.routineRuns.findFirst({ where: eq(routineRuns.routineId, id) }),
    ).toMatchObject({ status: "cancelled" });
  });

  it("deleting a routine stops its conversation", async () => {
    const runtime = fakeRuntime();
    setAgentRuntimeForTests(runtime);
    const routine = await createRoutine(app);
    const id = routine.id;
    expect((await api(app, `/api/v1/routines/${id}/run`, { method: "POST", token })).status).toBe(
      200,
    );
    expect((await api(app, `/api/v1/routines/${id}`, { method: "DELETE", token })).status).toBe(
      200,
    );
    expect(vi.mocked(runtime.abort)).toHaveBeenCalledWith(200);
    expect(vi.mocked(runtime.abort)).not.toHaveBeenCalledWith(100);
  });

  it("deleting a bot stops its routines' conversations too", async () => {
    const runtime = fakeRuntime();
    setAgentRuntimeForTests(runtime);
    const routine = await createRoutine(app);
    expect(
      (await api(app, `/api/v1/routines/${routine.id}/run`, { method: "POST", token })).status,
    ).toBe(200);
    expect(
      (await api(app, `/api/v1/bots/${routine.botId}`, { method: "DELETE", token })).status,
    ).toBe(200);
    expect(vi.mocked(runtime.abort).mock.calls.map(([ref]) => ref)).toEqual([100, 200]);
  });

  it("run-now on a recurring routine does not disturb the scheduled chain", async () => {
    const routine = await createRoutine(app);
    const firstJobId = (await routineRow(routine.id))?.pendingJobId;
    expect(
      (await api(app, `/api/v1/routines/${routine.id}/run`, { method: "POST", token })).status,
    ).toBe(200);
    // Manual runs do not requeue the chain.
    expect((await fireJobs()).map((job) => job.id)).toEqual([firstJobId]);
    const row = await routineRow(routine.id);
    expect(row?.enabled).toBe(true);
    expect(row?.pendingJobId).toBe(firstJobId);
  });

  it("lists a routine's runs and the recent runs feed", async () => {
    const botId = await seedBot();
    const [routine] = await db
      .insert(routines)
      .values({
        botId,
        name: "digest",
        prompt: "p",
        schedule: { kind: "cron", expr: "0 9 * * *" },
        enabled: false,
      })
      .returning();
    await db.insert(routineRuns).values({
      routineId: routine!.id,
      scheduledFor: new Date("2026-10-20T03:30:00Z"),
      status: "succeeded",
      requestId: "routine:x:2026-10-20T03:30:00.000Z",
      submittedAt: new Date(),
      output: "Digest ready.",
    });
    const mine = await api<{ runs: unknown[] }>(app, `/api/v1/routines/${routine!.id}/runs`, {
      token,
    });
    expect(mine.status).toBe(200);
    expect(mine.body.data!.runs).toHaveLength(1);

    const recent = await api<{ runs: Record<string, unknown>[] }>(
      app,
      "/api/v1/routines/runs/recent",
      { token },
    );
    expect(recent.status).toBe(200);
    const runs = recent.body.data!.runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      routineName: "digest",
      botName: "Helper",
      status: "succeeded",
    });
  });

  it("404s unknown routines and 400s an empty patch", async () => {
    expect((await api(app, "/api/v1/routines/nope", { token })).status).toBe(404);
    expect(
      (
        await api(app, "/api/v1/routines/nope", {
          method: "PATCH",
          json: { name: "x" },
          token,
        })
      ).status,
    ).toBe(404);
    const routine = await createRoutine(app);
    expect(
      (
        await api(app, `/api/v1/routines/${routine.id}`, {
          method: "PATCH",
          json: {},
          token,
        })
      ).status,
    ).toBe(400);
  });
});
