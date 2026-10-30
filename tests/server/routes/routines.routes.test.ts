/**
 * Routines REST API over the real SQLite test DB: CRUD, pause cancels the
 * queued job, run-now submits a manual occurrence, resume recomputes, and
 * validation errors are 400s. The agent runtime is a fake (bots.routes
 * pattern); the queue is mocked at the adapter boundary (addJob/cancelJob),
 * so assertions see exactly which queue jobs live or die.
 */
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { errorHandlerMiddleware } from "@groot/core/middlewares/error-handler.middleware";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { registerRoutes } from "../../../apps/web/src/server/routes";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";
import { ROUTINE_FIRE_JOB } from "../../../apps/web/src/server/api/routines/routines.jobs";
import type { AgentRuntime } from "@tiny-agents/agent";

const token = generateToken({ userId: 1, email: "routines-test@example.com" });
const authorization = { Authorization: `Bearer ${token}` };

let jobCounter = 0;
const sentJobs: { name: string; data: unknown; options: { delaySeconds?: number } }[] = [];
const cancelledJobs: { queueName: string; jobId: string }[] = [];

vi.mock("@groot/jobs/server/client", () => ({
  getJobQueue: () => ({
    send: vi.fn(async (name: string, data: unknown, options: { delaySeconds?: number }) => {
      jobCounter += 1;
      const jobId = `job-${jobCounter}`;
      sentJobs.push({ name, data, options: options ?? {} });
      return jobId;
    }),
    cancelJob: vi.fn(async (queueName: string, jobId: string) => {
      cancelledJobs.push({ queueName, jobId });
      return true;
    }),
    createQueue: vi.fn(async () => undefined),
  }),
  jobQueueReady: () => queueReady,
}));

/** Flipped by the disabled-queue test: arm paths must 503 with guidance. */
let queueReady = true;

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

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  registerRoutes(app);
  app.use(errorHandlerMiddleware);
  return app;
}

async function seedBot(): Promise<string> {
  const bot = await prisma.bot.create({
    data: { name: "Helper", modelId: "m1", conversationId: "100" },
  });
  return bot.id;
}

const cronPayload = {
  botId: "",
  name: "weekday-digest",
  prompt: "Summarize HN, only new things.",
  schedule: { kind: "cron", expr: "0 9 * * 1-5" },
};

async function createRoutine(app: Express, overrides: Record<string, unknown> = {}) {
  const botId = await seedBot();
  const response = await request(app)
    .post("/api/v1/routines")
    .set(authorization)
    .send({ ...cronPayload, botId, ...overrides })
    .expect(201);
  return response.body.data as Record<string, unknown>;
}

describe("Routines API routes", () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    queueReady = true;
    sentJobs.length = 0;
    cancelledJobs.length = 0;
    setAgentRuntimeForTests(fakeRuntime());
    app = buildApp();
    await prisma.routineRun.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.bot.deleteMany();
  });

  afterEach(async () => {
    await prisma.routineRun.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.bot.deleteMany();
  });

  it("requires authentication", async () => {
    const response = await request(app).get("/api/v1/routines");
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false });
  });

  it("503s with guidance when the job queue is disabled", async () => {
    queueReady = false;
    const bot = await prisma.bot.create({
      data: { name: "Queueless", modelId: "known-model", conversationId: "101" },
    });
    const response = await request(app)
      .post("/api/v1/routines")
      .set(authorization)
      .send({
        botId: bot.id,
        name: "Email check",
        prompt: "Check email",
        schedule: { kind: "interval", minutes: 30 },
      });
    expect(response.status).toBe(503);
    expect(response.body.error.message).toContain("jobs.enabled=true");
    // No half-armed row survives: the routine was never created.
    await expect(prisma.routine.count()).resolves.toBe(0);
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
    expect(sentJobs).toHaveLength(1);
    expect(sentJobs[0]).toMatchObject({ name: ROUTINE_FIRE_JOB });
    expect(sentJobs[0].data).toMatchObject({ routineId: routine.id, trigger: "schedule" });
    const row = await prisma.routine.findUnique({ where: { id: routine.id as string } });
    expect(row?.pendingJobId).toBeTypeOf("string");
    expect(row?.nextRunAt).toBeInstanceOf(Date);
  });

  it("creates a disabled routine without queueing", async () => {
    const routine = await createRoutine(app, { enabled: false });
    expect(routine.enabled).toBe(false);
    expect(sentJobs).toHaveLength(0);
    const row = await prisma.routine.findUnique({ where: { id: routine.id as string } });
    expect(row?.pendingJobId).toBeNull();
    expect(row?.nextRunAt).toBeNull();
  });

  it("lists routines with next run and description", async () => {
    await createRoutine(app);
    const response = await request(app).get("/api/v1/routines").set(authorization).expect(200);
    const list = response.body.data as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "weekday-digest", botName: "Helper" });
    expect(list[0].nextRunAt).toBeTruthy();
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
      const response = await request(app)
        .post("/api/v1/routines")
        .set(authorization)
        .send({ ...cronPayload, botId, ...overrides });
      expect(response.status).toBe(400);
    }
    expect(sentJobs).toHaveLength(0);
  });

  it("patches name without touching the queue, and a schedule change re-arms", async () => {
    const routine = await createRoutine(app);
    const firstJobId = (await prisma.routine.findUnique({ where: { id: routine.id as string } }))
      ?.pendingJobId as string;
    sentJobs.length = 0;

    const renamed = await request(app)
      .patch(`/api/v1/routines/${routine.id}`)
      .set(authorization)
      .send({ name: "renamed" })
      .expect(200);
    expect(renamed.body.data.name).toBe("renamed");
    expect(sentJobs).toHaveLength(0); // name-only edits keep the pending job

    const rescheduled = await request(app)
      .patch(`/api/v1/routines/${routine.id}`)
      .set(authorization)
      .send({ schedule: { kind: "interval", minutes: 30 } })
      .expect(200);
    expect(rescheduled.body.data.scheduleDescription).toBe("Every 30 minutes");
    expect(cancelledJobs).toContainEqual({
      queueName: ROUTINE_FIRE_JOB,
      jobId: firstJobId,
    });
    expect(sentJobs).toHaveLength(1);
    expect(sentJobs[0].data).toMatchObject({ routineId: routine.id, trigger: "schedule" });
  });

  it("a schedule edit on a paused routine stays paused", async () => {
    const routine = await createRoutine(app);
    await request(app).post(`/api/v1/routines/${routine.id}/pause`).set(authorization).expect(200);
    cancelledJobs.length = 0;
    sentJobs.length = 0;

    const edited = await request(app)
      .patch(`/api/v1/routines/${routine.id}`)
      .set(authorization)
      .send({ schedule: { kind: "interval", minutes: 45 } })
      .expect(200);
    expect(edited.body.data.enabled).toBe(false);
    expect(sentJobs).toHaveLength(0); // paused stays paused despite the new schedule
  });

  it("pause cancels the pending job and clears the slot; resume re-arms from now", async () => {
    const routine = await createRoutine(app);
    const firstJobId = (await prisma.routine.findUnique({ where: { id: routine.id as string } }))
      ?.pendingJobId as string;
    sentJobs.length = 0;

    const paused = await request(app)
      .post(`/api/v1/routines/${routine.id}/pause`)
      .set(authorization)
      .expect(200);
    expect(paused.body.data.enabled).toBe(false);
    expect(cancelledJobs).toEqual([{ queueName: ROUTINE_FIRE_JOB, jobId: firstJobId }]);
    const pausedRow = await prisma.routine.findUnique({ where: { id: routine.id as string } });
    expect(pausedRow?.pendingJobId).toBeNull();
    expect(pausedRow?.nextRunAt).toBeNull();

    const resumed = await request(app)
      .post(`/api/v1/routines/${routine.id}/resume`)
      .set(authorization)
      .expect(200);
    expect(resumed.body.data.enabled).toBe(true);
    expect(sentJobs).toHaveLength(1);
    const row = await prisma.routine.findUnique({ where: { id: routine.id as string } });
    expect(row?.pendingJobId).toBeTypeOf("string");
    expect(row?.pendingJobId).not.toBe(firstJobId);
    expect(row?.nextRunAt).toBeInstanceOf(Date);
  });

  it("deleting cancels the pending job and cascades runs", async () => {
    const routine = await createRoutine(app);
    const id = routine.id as string;
    const pendingJobId = (await prisma.routine.findUnique({ where: { id } }))?.pendingJobId;
    await request(app).delete(`/api/v1/routines/${id}`).set(authorization).expect(200);
    expect(cancelledJobs).toEqual([{ queueName: ROUTINE_FIRE_JOB, jobId: pendingJobId }]);
    expect(await prisma.routine.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.routineRun.count()).toBe(0);
  });

  it("run-now submits a manual occurrence without archiving a future once routine", async () => {
    const runtime = fakeRuntime();
    setAgentRuntimeForTests(runtime);
    const routine = await createRoutine(app, {
      schedule: { kind: "once", at: "2026-11-01T09:00:00+05:30" },
    });
    sentJobs.length = 0;

    const response = await request(app)
      .post(`/api/v1/routines/${routine.id}/run`)
      .set(authorization)
      .expect(200);
    const runId = (response.body.data as { runId: string }).runId;
    expect(runId).toBeTruthy();

    const run = await prisma.routineRun.findUnique({ where: { id: runId } });
    expect(run).toMatchObject({ status: "awaiting", trigger: "manual" });
    expect(run?.requestId).toMatch(/^routine:[a-z0-9]+:\d{4}-\d{2}-\d{2}T/);

    // Into the routine's own conversation, never the bot's chat (100).
    const submits = vi.mocked(runtime.submit).mock.calls;
    expect(submits).toHaveLength(1);
    expect(submits[0][0]).toBe(200);
    expect(submits[0][1].requestId).toBe(run?.requestId);
    expect(submits[0][1].text).toContain('**Routine "weekday-digest"');
    expect(submits[0][1].text).toContain("Summarize HN, only new things.");
    // The scheduled occurrence is still pending, so a manual run leaves the
    // chain armed (only the scheduled fire archives a once routine).
    const row = await prisma.routine.findUnique({ where: { id: routine.id as string } });
    expect(row?.enabled).toBe(true);
    expect(row?.pendingJobId).toBeTypeOf("string");
  });

  it("moving a routine to another bot gives it a fresh conversation for that bot", async () => {
    const runtime = fakeRuntime();
    setAgentRuntimeForTests(runtime);
    const routine = await createRoutine(app);
    const id = routine.id as string;
    await request(app).post(`/api/v1/routines/${id}/run`).set(authorization).expect(200);
    expect((await prisma.routine.findUnique({ where: { id } }))?.conversationId).toBe("200");

    const other = await prisma.bot.create({
      data: { name: "Other", modelId: "m1", conversationId: "101" },
    });
    await request(app)
      .patch(`/api/v1/routines/${id}`)
      .set(authorization)
      .send({ botId: other.id })
      .expect(200);
    expect((await prisma.routine.findUnique({ where: { id } }))?.conversationId).toBeNull();
    expect(vi.mocked(runtime.abort)).toHaveBeenCalledWith(200);
    // The run awaiting in the old conversation never gets its reply now.
    expect(await prisma.routineRun.findFirst({ where: { routineId: id } })).toMatchObject({
      status: "cancelled",
    });
  });

  it("deleting a routine stops its conversation", async () => {
    const runtime = fakeRuntime();
    setAgentRuntimeForTests(runtime);
    const routine = await createRoutine(app);
    const id = routine.id as string;
    await request(app).post(`/api/v1/routines/${id}/run`).set(authorization).expect(200);
    await request(app).delete(`/api/v1/routines/${id}`).set(authorization).expect(200);
    expect(vi.mocked(runtime.abort)).toHaveBeenCalledWith(200);
    expect(vi.mocked(runtime.abort)).not.toHaveBeenCalledWith(100);
  });

  it("deleting a bot stops its routines' conversations too", async () => {
    const runtime = fakeRuntime();
    setAgentRuntimeForTests(runtime);
    const routine = await createRoutine(app);
    await request(app).post(`/api/v1/routines/${routine.id}/run`).set(authorization).expect(200);
    await request(app).delete(`/api/v1/bots/${routine.botId}`).set(authorization).expect(200);
    expect(vi.mocked(runtime.abort).mock.calls.map(([ref]) => ref)).toEqual([100, 200]);
  });

  it("run-now on a recurring routine does not disturb the scheduled chain", async () => {
    const routine = await createRoutine(app);
    sentJobs.length = 0;
    await request(app).post(`/api/v1/routines/${routine.id}/run`).set(authorization).expect(200);
    expect(sentJobs).toHaveLength(0); // manual runs do not requeue the chain
    const row = await prisma.routine.findUnique({ where: { id: routine.id as string } });
    expect(row?.enabled).toBe(true);
    expect(row?.pendingJobId).toBeTypeOf("string");
  });

  it("lists a routine's runs and the recent runs feed", async () => {
    const botId = await seedBot();
    const routine = await prisma.routine.create({
      data: {
        botId,
        name: "digest",
        prompt: "p",
        schedule: { kind: "cron", expr: "0 9 * * *" },
        enabled: false,
      },
    });
    await prisma.routineRun.create({
      data: {
        routineId: routine.id,
        scheduledFor: new Date("2026-10-20T03:30:00Z"),
        status: "succeeded",
        requestId: "routine:x:2026-10-20T03:30:00.000Z",
        submittedAt: new Date(),
        output: "Digest ready.",
      },
    });
    const mine = await request(app)
      .get(`/api/v1/routines/${routine.id}/runs`)
      .set(authorization)
      .expect(200);
    expect(mine.body.data.runs as unknown[]).toHaveLength(1);

    const recent = await request(app)
      .get("/api/v1/routines/runs/recent")
      .set(authorization)
      .expect(200);
    const runs = recent.body.data.runs as Record<string, unknown>[];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      routineName: "digest",
      botName: "Helper",
      status: "succeeded",
    });
  });

  it("404s unknown routines and 400s an empty patch", async () => {
    await request(app).get("/api/v1/routines/nope").set(authorization).expect(404);
    await request(app)
      .patch("/api/v1/routines/nope")
      .set(authorization)
      .send({ name: "x" })
      .expect(404);
    const routine = await createRoutine(app);
    await request(app)
      .patch(`/api/v1/routines/${routine.id}`)
      .set(authorization)
      .send({})
      .expect(400);
  });
});
