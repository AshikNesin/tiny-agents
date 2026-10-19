/**
 * Engine tests: the routine-fire handler's exactly-once contract (double
 * delivery, crash between submit and chain, missed-run grace, late once) and
 * the completion watcher (idle resolution, restart boot sweep). Real SQLite
 * test DB, fake runtime, queue mocked at the adapter boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { setAgentRuntimeForTests } from "../../../../apps/web/src/server/api/bots/bots.runtime";
import {
  dispatchOccurrence,
  runRequestId,
  type RoutineFirePayload,
} from "../../../../apps/web/src/server/api/routines/routines.jobs";
import { createRoutinesCompletionWatcher } from "../../../../apps/web/src/server/api/routines/routines.watcher";
import type { AgentRuntime } from "@tiny-agents/agent";

let jobCounter = 0;
const sentJobs: { name: string; data: unknown }[] = [];

vi.mock("@groot/jobs/server/client", () => ({
  getJobQueue: () => ({
    send: vi.fn(async (name: string, data: unknown) => {
      jobCounter += 1;
      sentJobs.push({ name, data });
      return `job-${jobCounter}`;
    }),
    cancelJob: vi.fn(async () => true),
    createQueue: vi.fn(async () => undefined),
  }),
  jobQueueReady: () => true,
}));

/** Assistant messages the watcher's chat snapshot will carry. */
let chatReplies: { text: string; createdAt: number }[] = [];

function fakeRuntime(overrides: Partial<Record<string, unknown>> = {}) {
  const emptyChat = { messages: [], busy: false };
  return {
    createConversation: vi.fn(),
    configure: vi.fn().mockResolvedValue(undefined),
    submit: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    watchChat: vi.fn(async (_ref: number, listener: (events: unknown[]) => void) => {
      await listener([
        {
          type: "snapshot",
          state: {
            busy: false,
            ...emptyChat,
            messages: chatReplies.map((reply, index) => ({
              id: `m${index}`,
              role: "assistant",
              text: reply.text,
              createdAt: reply.createdAt,
              status: "done",
            })),
          },
        },
      ]);
      return { initial: emptyChat, stop: async () => undefined };
    }),
    isBusy: vi.fn().mockReturnValue(false),
    busyConversations: vi.fn().mockReturnValue([]),
    lastMessage: vi.fn().mockResolvedValue(undefined),
    onActivity: vi.fn().mockReturnValue(() => undefined),
    listModels: vi.fn().mockReturnValue([]),
    hasModel: vi.fn().mockReturnValue(true),
    listCapabilities: vi.fn().mockReturnValue([]),
    pendingApprovals: vi.fn().mockReturnValue(0),
    decideApproval: vi.fn(),
    ...overrides,
  } as unknown as AgentRuntime;
}

async function seedBotAndRoutine(schedule: unknown, options: { enabled?: boolean } = {}) {
  const bot = await prisma.bot.create({
    data: { name: "Bot", modelId: "m1", conversationId: "7", toolkits: "[]" },
  });
  const routine = await prisma.routine.create({
    data: {
      botId: bot.id,
      name: "digest",
      prompt: "Do the thing.",
      schedule: schedule as object,
      enabled: options.enabled ?? true,
    },
  });
  return { bot, routine };
}

const SLOT = new Date("2026-10-21T03:30:00.000Z"); // 09:00 IST Wed
const ON_TIME = new Date("2026-10-21T03:30:05.000Z");

function payloadOf(
  routineId: string,
  scheduledFor: Date,
  trigger: "schedule" | "manual" = "schedule",
) {
  return {
    routineId,
    scheduledFor: scheduledFor.toISOString(),
    trigger,
  } satisfies RoutineFirePayload;
}

describe("routine-fire dispatch", () => {
  let runtime: ReturnType<typeof fakeRuntime>;

  beforeEach(async () => {
    vi.clearAllMocks();
    jobCounter = 0;
    sentJobs.length = 0;
    chatReplies = [];
    runtime = fakeRuntime();
    setAgentRuntimeForTests(runtime);
    await prisma.routineRun.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.bot.deleteMany();
  });

  afterEach(async () => {
    await prisma.routineRun.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.bot.deleteMany();
  });

  it("fires on time: one run row, one labeled submit, next occurrence chained", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);

    expect(await prisma.routineRun.count({ where: { routineId: routine.id } })).toBe(1);
    const run = await prisma.routineRun.findFirst({ where: { routineId: routine.id } });
    expect(run).toMatchObject({ status: "awaiting", trigger: "schedule" });
    expect(run?.requestId).toBe(runRequestId(routine.id, SLOT));

    const submits = vi.mocked(runtime.submit).mock.calls;
    expect(submits).toHaveLength(1);
    expect(submits[0][0]).toBe(7);
    expect(submits[0][1].requestId).toBe(runRequestId(routine.id, SLOT));
    expect(submits[0][1].text).toContain('Routine "digest"');
    expect(submits[0][1].text).toContain("Wed, 21 Oct 2026, 09:00 IST");

    // The chain advanced: next slot queued with a fresh pendingJobId.
    expect(sentJobs).toHaveLength(1);
    expect(sentJobs[0].data).toMatchObject({
      routineId: routine.id,
      scheduledFor: "2026-10-22T03:30:00.000Z",
      trigger: "schedule",
    });
    const row = await prisma.routine.findUnique({ where: { id: routine.id } });
    expect(row?.nextRunAt?.toISOString()).toBe("2026-10-22T03:30:00.000Z");
  });

  it("double delivery is exactly-once: one run, one submit, one chain job", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);

    expect(await prisma.routineRun.count({ where: { routineId: routine.id } })).toBe(1);
    expect(vi.mocked(runtime.submit).mock.calls).toHaveLength(1);
    expect(sentJobs).toHaveLength(1);
  });

  it("a crash between submit and chaining is repaired by the redelivery", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    // Simulate the crash: the row kept awaiting status but the chain never queued.
    await prisma.routine.update({ where: { id: routine.id }, data: { pendingJobId: null } });
    sentJobs.length = 0;

    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    expect(sentJobs).toHaveLength(1); // chain repaired
    expect(vi.mocked(runtime.submit).mock.calls).toHaveLength(1); // no duplicate submit
  });

  it("an overdue occurrence beyond grace is recorded missed and never submitted", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" }); // grace 120m
    const veryLate = new Date(SLOT.getTime() + 3 * 60 * 60_000);
    await dispatchOccurrence(payloadOf(routine.id, SLOT), veryLate);

    const run = await prisma.routineRun.findFirst({ where: { routineId: routine.id } });
    expect(run).toMatchObject({ status: "missed" });
    expect(vi.mocked(runtime.submit)).not.toHaveBeenCalled();
    // Backlog collapses: the next job schedules from now, not from the stale slot.
    expect(sentJobs).toHaveLength(1);
    const row = await prisma.routine.findUnique({ where: { id: routine.id } });
    expect(row?.nextRunAt).toBeTruthy();
    expect(row!.nextRunAt!.getTime()).toBeGreaterThan(veryLate.getTime());
  });

  it("a late once still fires and carries the lateness note", async () => {
    const at = new Date("2026-10-20T03:30:00.000Z"); // 09:00 IST Tue
    const { routine } = await seedBotAndRoutine({
      kind: "once",
      at: at.toISOString(),
    });
    const late = new Date(at.getTime() + 5 * 60_000);
    await dispatchOccurrence(payloadOf(routine.id, at), late);

    const run = await prisma.routineRun.findFirst({ where: { routineId: routine.id } });
    expect(run?.status).toBe("awaiting");
    const text = vi.mocked(runtime.submit).mock.calls[0][1].text as string;
    expect(text).toContain("(late by 5m)");
    // A fired once archives itself.
    const row = await prisma.routine.findUnique({ where: { id: routine.id } });
    expect(row).toMatchObject({ enabled: false, nextRunAt: null, pendingJobId: null });
    expect(sentJobs).toHaveLength(0);
  });

  it("a deleted routine (orphan job) acks and exits", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    const id = routine.id;
    await prisma.routine.delete({ where: { id } });
    await expect(dispatchOccurrence(payloadOf(id, SLOT), ON_TIME)).resolves.toBeUndefined();
    expect(vi.mocked(runtime.submit)).not.toHaveBeenCalled();
  });

  it("a job racing a pause is a phantom fire and does not submit", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await prisma.routine.update({
      where: { id: routine.id },
      data: { enabled: false, nextRunAt: null, pendingJobId: null },
    });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    expect(vi.mocked(runtime.submit)).not.toHaveBeenCalled();
    expect(await prisma.routineRun.count()).toBe(0);
  });

  it("manual trigger on a paused routine still fires", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await prisma.routine.update({
      where: { id: routine.id },
      data: { enabled: false, nextRunAt: null, pendingJobId: null },
    });
    await dispatchOccurrence(payloadOf(routine.id, SLOT, "manual"), ON_TIME);
    expect(vi.mocked(runtime.submit)).toHaveBeenCalledTimes(1);
    // Manual runs never touch the chain.
    expect(sentJobs).toHaveLength(0);
  });

  it("a submit failure fails the run once, pauses the routine, and notifies the chat", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await prisma.routine.update({
      where: { id: routine.id },
      data: { pendingJobId: "job-99" },
    });
    const failing = fakeRuntime({ submit: vi.fn().mockRejectedValue(new Error("model gone")) });
    setAgentRuntimeForTests(failing);
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await prisma.routineRun.findUnique({
      where: { routineId_scheduledFor: { routineId: routine.id, scheduledFor: SLOT } },
    });
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("model gone");
    const after = await prisma.routine.findUnique({ where: { id: routine.id } });
    expect(after?.enabled).toBe(false);
    expect(after?.pendingJobId).toBeNull();
    expect(after?.nextRunAt).toBeNull();
    expect(sentJobs).toHaveLength(0); // no chain after a failed submit
    const notice = vi
      .mocked(failing.submit)
      .mock.calls.find(
        ([_ref, message]) => typeof message.text === "string" && message.text.includes("paused"),
      );
    expect(notice).toBeTruthy();
    expect(String(notice?.[0])).toBe("7");
  });
});

describe("completion watcher", () => {
  let runtime: ReturnType<typeof fakeRuntime>;

  function chatWith(replies: { text: string; createdAt: number }[]) {
    chatReplies = replies;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    chatReplies = [];
    runtime = fakeRuntime();
    setAgentRuntimeForTests(runtime);
    await prisma.routineRun.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.bot.deleteMany();
  });

  afterEach(async () => {
    await prisma.routineRun.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.bot.deleteMany();
  });

  it("marks a run succeeded with a 2000-char preview when the reply lands", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await prisma.routineRun.findFirst({ where: { routineId: routine.id } });
    const submittedAt = run!.submittedAt!;

    chatWith([
      { text: "Older reply", createdAt: submittedAt.getTime() - 1000 },
      { text: "x".repeat(2500), createdAt: submittedAt.getTime() + 1000 },
    ]);
    const watcher = createRoutinesCompletionWatcher(runtime);
    const resolved = await watcher.resolveConversation(7);
    expect(resolved).toBe(1);

    const after = await prisma.routineRun.findUnique({ where: { id: run!.id } });
    expect(after?.status).toBe("succeeded");
    expect(after?.output?.length).toBe(2000);
    expect(after?.finishedAt).toBeTruthy();
  });

  it("a model error reply marks the run failed", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await prisma.routineRun.findFirst({ where: { routineId: routine.id } });
    const submittedAt = run!.submittedAt!;

    chatWith([{ text: "⚠ Model error: gateway down", createdAt: submittedAt.getTime() + 1000 }]);
    const watcher = createRoutinesCompletionWatcher(runtime);
    await watcher.resolveConversation(7);

    const after = await prisma.routineRun.findUnique({ where: { id: run!.id } });
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("Model error");
  });

  it("two awaiting runs on one conversation each get their own reply", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    const first = await prisma.routineRun.create({
      data: {
        routineId: routine.id,
        scheduledFor: new Date("2026-10-21T03:30:00Z"),
        status: "awaiting",
        requestId: "routine:x:1",
        submittedAt: new Date("2026-10-21T03:30:01Z"),
      },
    });
    const second = await prisma.routineRun.create({
      data: {
        routineId: routine.id,
        scheduledFor: new Date("2026-10-22T03:30:00Z"),
        status: "awaiting",
        requestId: "routine:x:2",
        submittedAt: new Date("2026-10-22T03:30:01Z"),
      },
    });
    chatWith([
      { text: "First reply", createdAt: first.submittedAt!.getTime() + 1000 },
      { text: "Second reply", createdAt: second.submittedAt!.getTime() + 1000 },
    ]);
    const watcher = createRoutinesCompletionWatcher(runtime);
    const resolved = await watcher.resolveConversation(7);
    expect(resolved).toBe(2);
    const afterFirst = await prisma.routineRun.findUnique({ where: { id: first.id } });
    const afterSecond = await prisma.routineRun.findUnique({ where: { id: second.id } });
    expect(afterFirst?.output).toBe("First reply");
    expect(afterSecond?.output).toBe("Second reply");
  });

  it("a stale reply (pre-submit) never answers; the run keeps awaiting", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await prisma.routineRun.findFirst({ where: { routineId: routine.id } });

    chatWith([{ text: "Before the run", createdAt: run!.submittedAt!.getTime() - 5000 }]);
    const watcher = createRoutinesCompletionWatcher(runtime);
    const resolved = await watcher.resolveConversation(7);
    expect(resolved).toBe(0);
    const after = await prisma.routineRun.findUnique({ where: { id: run!.id } });
    expect(after?.status).toBe("awaiting");
  });

  it("boot sweep marks awaiting runs on idle conversations interrupted", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await prisma.routineRun.findFirst({ where: { routineId: routine.id } });

    const watcher = createRoutinesCompletionWatcher(runtime);
    const resolved = await watcher.bootSweep();
    expect(resolved).toBe(1);
    const after = await prisma.routineRun.findUnique({ where: { id: run!.id } });
    expect(after).toMatchObject({ status: "failed", error: "interrupted" });
  });

  it("boot sweep leaves runs on busy conversations for the idle listener", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await prisma.routineRun.findFirst({ where: { routineId: routine.id } });

    const busyRuntime = fakeRuntime({ isBusy: vi.fn().mockReturnValue(true) });
    const watcher = createRoutinesCompletionWatcher(busyRuntime);
    const resolved = await watcher.bootSweep();
    expect(resolved).toBe(0);
    const after = await prisma.routineRun.findUnique({ where: { id: run!.id } });
    expect(after?.status).toBe("awaiting");
  });
});
