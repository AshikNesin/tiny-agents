/**
 * Engine tests: the routine-fire handler's exactly-once contract (double
 * delivery, crash between submit and chain, missed-run grace, late once),
 * the routine's own conversation (issue #63: never the bot's chat), and the
 * completion watcher (idle resolution, refused tools, restart boot sweep,
 * chat cards). Real SQLite test DB, fake runtime, queue mocked at the
 * adapter boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { setAgentRuntimeForTests } from "../../../../apps/web/src/server/api/bots/bots.runtime";
import {
  dispatchOccurrence,
  runRequestId,
  type RoutineFirePayload,
} from "../../../../apps/web/src/server/api/routines/routines.jobs";
import {
  createRoutinesCompletionWatcher,
  refusalReason,
} from "../../../../apps/web/src/server/api/routines/routines.watcher";
import {
  chatCards,
  onRoutineCard,
  type RoutineRunCard,
} from "../../../../apps/web/src/server/api/routines/routines.cards";
import type { AgentRuntime, FinishedReply } from "@tiny-agents/agent";

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

/** The bot's chat, where the owner talks (seeded on the bot row). */
const CHAT = 7;
/** The conversation the fake runtime creates for a routine on its first fire. */
const ROUTINE_CONVERSATION = 42;

/** Finished replies the runtime reports for the routine's conversation. */
let chatReplies: FinishedReply[] = [];

function fakeRuntime(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    createConversation: vi.fn().mockResolvedValue(ROUTINE_CONVERSATION),
    configure: vi.fn().mockResolvedValue(undefined),
    submit: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    finishedReplies: vi.fn(async () => chatReplies),
    isBusy: vi.fn().mockReturnValue(false),
    busyConversations: vi.fn().mockReturnValue([]),
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
    data: { name: "Bot", modelId: "m1", conversationId: String(CHAT) },
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

    // Into the routine's own conversation, created on this first fire from
    // the bot's config and set to refuse what would ask: never the chat.
    const submits = vi.mocked(runtime.submit).mock.calls;
    expect(submits).toHaveLength(1);
    expect(submits[0][0]).toBe(ROUTINE_CONVERSATION);
    expect(vi.mocked(runtime.createConversation)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runtime.createConversation).mock.calls[0][0].capabilities).toMatchObject({
      unattended: true,
    });
    expect(vi.mocked(runtime.configure)).toHaveBeenCalledWith(
      ROUTINE_CONVERSATION,
      expect.objectContaining({ capabilities: expect.objectContaining({ unattended: true }) }),
    );
    expect(vi.mocked(runtime.configure).mock.calls.some(([ref]) => ref === CHAT)).toBe(false);
    expect((await prisma.routine.findUnique({ where: { id: routine.id } }))?.conversationId).toBe(
      String(ROUTINE_CONVERSATION),
    );
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

  it("every run of a routine shares its conversation, so later runs see earlier ones", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const nextSlot = new Date("2026-10-22T03:30:00.000Z");
    await dispatchOccurrence(payloadOf(routine.id, nextSlot), new Date(nextSlot.getTime() + 5000));
    expect(vi.mocked(runtime.createConversation)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runtime.submit).mock.calls.map(([ref]) => ref)).toEqual([
      ROUTINE_CONVERSATION,
      ROUTINE_CONVERSATION,
    ]);
  });

  it("two routines of one bot get conversations of their own", async () => {
    const { bot, routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    const other = await prisma.routine.create({
      data: {
        botId: bot.id,
        name: "other",
        prompt: "Other thing.",
        schedule: { kind: "cron", expr: "0 9 * * 1-5" },
      },
    });
    vi.mocked(runtime.createConversation)
      .mockResolvedValueOnce(ROUTINE_CONVERSATION)
      .mockResolvedValueOnce(43);
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    await dispatchOccurrence(payloadOf(other.id, SLOT), ON_TIME);
    expect(vi.mocked(runtime.submit).mock.calls.map(([ref]) => ref)).toEqual([
      ROUTINE_CONVERSATION,
      43,
    ]);
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

  it("a submit failure fails the run once and pauses the routine, leaving the chat alone", async () => {
    const { bot, routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
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
    // The failed run's card says the routine paused; nothing is written to the chat.
    expect(run?.error).toContain("paused");
    const after = await prisma.routine.findUnique({ where: { id: routine.id } });
    expect(after?.enabled).toBe(false);
    expect(after?.pendingJobId).toBeNull();
    expect(after?.nextRunAt).toBeNull();
    expect(sentJobs).toHaveLength(0); // no chain after a failed submit
    expect(vi.mocked(failing.submit).mock.calls.map(([ref]) => ref)).toEqual([
      ROUTINE_CONVERSATION,
    ]);
    expect(await chatCards(bot.id)).toEqual([
      expect.objectContaining({ id: run!.id, status: "failed" }),
    ]);
  });

  it("a model removed from the catalog pauses the routine instead of retrying", async () => {
    // The reconcile before submit is where a vanished model throws
    // (ModelNotFoundError); it must take the same fail-once path as submit.
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    const failing = fakeRuntime({
      configure: vi.fn().mockRejectedValue(new Error('Unknown model "m1"')),
    });
    setAgentRuntimeForTests(failing);
    await expect(dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME)).resolves.toBeUndefined();
    const run = await prisma.routineRun.findUnique({
      where: { routineId_scheduledFor: { routineId: routine.id, scheduledFor: SLOT } },
    });
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("Unknown model");
    expect((await prisma.routine.findUnique({ where: { id: routine.id } }))?.enabled).toBe(false);
  });
});

describe("completion watcher", () => {
  let runtime: ReturnType<typeof fakeRuntime>;

  function chatWith(replies: FinishedReply[]) {
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
    const resolved = await watcher.resolveConversation(ROUTINE_CONVERSATION);
    expect(resolved).toBe(1);

    const after = await prisma.routineRun.findUnique({ where: { id: run!.id } });
    expect(after?.status).toBe("succeeded");
    expect(after?.output?.length).toBe(2000);
    expect(after?.finishedAt).toBeTruthy();
  });

  it("the owner chatting meanwhile never answers the run: only its own conversation does", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await prisma.routineRun.findFirst({ where: { routineId: routine.id } });
    const submittedAt = run!.submittedAt!.getTime();
    const replies: Record<number, FinishedReply[]> = {
      [CHAT]: [{ text: "Owner's answer", createdAt: submittedAt + 500 }],
      [ROUTINE_CONVERSATION]: [{ text: "Routine's answer", createdAt: submittedAt + 1000 }],
    };
    const split = fakeRuntime({
      finishedReplies: vi.fn(async (ref: number) => replies[ref] ?? []),
    });
    const watcher = createRoutinesCompletionWatcher(split);

    expect(await watcher.resolveConversation(CHAT)).toBe(0);
    expect((await prisma.routineRun.findUnique({ where: { id: run!.id } }))?.status).toBe(
      "awaiting",
    );
    expect(await watcher.resolveConversation(ROUTINE_CONVERSATION)).toBe(1);
    expect(await prisma.routineRun.findUnique({ where: { id: run!.id } })).toMatchObject({
      status: "succeeded",
      output: "Routine's answer",
    });
  });

  it("a refused ask tool fails the run, naming the tool and how to allow it", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await prisma.routineRun.findFirst({ where: { routineId: routine.id } });
    const submittedAt = run!.submittedAt!.getTime();

    chatWith([
      { text: "", createdAt: submittedAt + 500, refused: ["send_email"] },
      { text: "Drafted the email but could not send it.", createdAt: submittedAt + 1000 },
    ]);
    const watcher = createRoutinesCompletionWatcher(runtime);
    expect(await watcher.resolveConversation(ROUTINE_CONVERSATION)).toBe(1);

    expect(await prisma.routineRun.findUnique({ where: { id: run!.id } })).toMatchObject({
      status: "failed",
      error: "Needs approval for `send_email`; set it to Allow for this bot to use it in routines.",
      output: "Drafted the email but could not send it.",
    });
  });

  it("explains tools that can never be allowed apart from those that can", () => {
    expect(refusalReason(["send_email", "save_skill"], new Set(["save_skill"]))).toBe(
      "Needs approval for `send_email`; set it to Allow for this bot to use it in routines. " +
        "`save_skill` always asks for approval, so routines can't use it.",
    );
    expect(refusalReason(["a", "b"], new Set())).toBe(
      "Needs approval for `a`, `b`; set them to Allow for this bot to use them in routines.",
    );
  });

  it("a finished run shows as a card in its bot's chat, live and on connect", async () => {
    const { bot, routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await prisma.routineRun.findFirst({ where: { routineId: routine.id } });
    // An awaiting run has no card yet.
    expect(await chatCards(bot.id)).toEqual([]);

    const seen: { botId: string; card: RoutineRunCard }[] = [];
    const stop = onRoutineCard((botId, card) => seen.push({ botId, card }));
    chatWith([{ text: "**All** good", createdAt: run!.submittedAt!.getTime() + 1000 }]);
    await createRoutinesCompletionWatcher(runtime).resolveConversation(ROUTINE_CONVERSATION);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    stop();

    const card = {
      id: run!.id,
      routineId: routine.id,
      routineName: "digest",
      status: "succeeded",
      trigger: "schedule",
      output: "**All** good",
      error: null,
    };
    expect(seen[0]).toEqual({ botId: bot.id, card: expect.objectContaining(card) });
    expect(await chatCards(bot.id)).toEqual([expect.objectContaining(card)]);
  });

  it("a model error reply marks the run failed", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await prisma.routineRun.findFirst({ where: { routineId: routine.id } });
    const submittedAt = run!.submittedAt!;

    chatWith([
      { text: "", createdAt: submittedAt.getTime() + 1000, error: "Model error: gateway down" },
    ]);
    const watcher = createRoutinesCompletionWatcher(runtime);
    await watcher.resolveConversation(ROUTINE_CONVERSATION);

    const after = await prisma.routineRun.findUnique({ where: { id: run!.id } });
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("Model error");
  });

  it("two awaiting runs on one conversation each get their own reply", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await prisma.routine.update({
      where: { id: routine.id },
      data: { conversationId: String(ROUTINE_CONVERSATION) },
    });
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
    const resolved = await watcher.resolveConversation(ROUTINE_CONVERSATION);
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
    const resolved = await watcher.resolveConversation(ROUTINE_CONVERSATION);
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
