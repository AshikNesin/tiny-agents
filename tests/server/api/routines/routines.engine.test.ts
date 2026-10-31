/**
 * Engine tests: the routine-fire handler's exactly-once contract (double
 * delivery, crash between submit and chain, missed-run grace, late once),
 * the routine's own conversation (issue #63: never the bot's chat), and the
 * completion watcher (idle resolution, refused tools, restart boot sweep,
 * chat cards). Real SQLite test DB, fake runtime, and the real queue table
 * (no worker runs in tests, so queued jobs only wait there).
 */
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { bots, db, jobs, routineRuns, routines } from "../../../../apps/web/src/server/db";
import { dispatchOccurrence } from "../../../../apps/web/src/server/api/routines/routines.jobs";
import { runNow } from "../../../../apps/web/src/server/api/routines/routines.service";
import {
  ROUTINE_FIRE_JOB,
  type RoutineFirePayload,
} from "../../../../apps/web/src/server/api/routines/routines.chain";
import {
  createRoutineRunResolver as createRoutinesCompletionWatcher,
  refusalReason,
  runRequestId,
} from "../../../../apps/web/src/server/api/routines/routines.runs";
import {
  chatCards,
  onRoutineCard,
  type RoutineRunCard,
} from "../../../../apps/web/src/server/api/routines/routines.cards";
import type { AgentRuntime, FinishedReply } from "@tiny-agents/agent";
import {
  createFakeRuntime,
  installFakeRuntime,
  resetAppTables,
  type FakeRuntime,
} from "../../fixtures";

/** Routine-fire jobs queued so far, oldest first. */
async function sentJobs() {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.name, ROUTINE_FIRE_JOB))
    .orderBy(sql`rowid`);
}

async function routineRow(id: string) {
  return db.query.routines.findFirst({ where: eq(routines.id, id) });
}

async function runOf(routineId: string, scheduledFor?: Date) {
  return db.query.routineRuns.findFirst({
    where: and(
      eq(routineRuns.routineId, routineId),
      scheduledFor ? eq(routineRuns.scheduledFor, scheduledFor) : undefined,
    ),
  });
}

async function runById(id: string) {
  return db.query.routineRuns.findFirst({ where: eq(routineRuns.id, id) });
}

const clearTables = resetAppTables;

/** The bot's chat, where the owner talks (seeded on the bot row). */
const CHAT = 7;
/** The conversation the fake runtime creates for a routine on its first fire. */
const ROUTINE_CONVERSATION = 42;

/** The shared fake, with the routine's conversation created on its first fire. */
function fakeRuntime(overrides: Partial<FakeRuntime> = {}) {
  const fake = createFakeRuntime(overrides);
  if (!overrides.createConversation)
    fake.createConversation.mockResolvedValue(ROUTINE_CONVERSATION);
  return fake;
}

async function seedBotAndRoutine(schedule: unknown, options: { enabled?: boolean } = {}) {
  const [bot] = await db
    .insert(bots)
    // The chat thread started before the fixed slots these tests fire at.
    .values({
      name: "Bot",
      modelId: "m1",
      conversationId: String(CHAT),
      chatStartedAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning();
  const [routine] = await db
    .insert(routines)
    .values({
      botId: bot!.id,
      name: "digest",
      prompt: "Do the thing.",
      schedule,
      enabled: options.enabled ?? true,
    })
    .returning();
  return { bot: bot!, routine: routine! };
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
    runtime = fakeRuntime();
    installFakeRuntime(runtime);
    await clearTables();
  });

  afterEach(clearTables);

  it("fires on time: one run row, one labeled submit, next occurrence chained", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);

    expect(await db.$count(routineRuns, eq(routineRuns.routineId, routine.id))).toBe(1);
    const run = await runOf(routine.id);
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
    expect((await routineRow(routine.id))?.conversationId).toBe(String(ROUTINE_CONVERSATION));
    expect(submits[0][1].requestId).toBe(runRequestId(routine.id, SLOT));
    expect(submits[0][1].text).toContain('Routine "digest"');
    expect(submits[0][1].text).toContain("Wed, 21 Oct 2026, 09:00 IST");

    // The chain advanced: next slot queued with a fresh pendingJobId.
    const queued = await sentJobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.data).toMatchObject({
      routineId: routine.id,
      scheduledFor: "2026-10-22T03:30:00.000Z",
      trigger: "schedule",
    });
    const row = await routineRow(routine.id);
    expect(row?.nextRunAt?.toISOString()).toBe("2026-10-22T03:30:00.000Z");
    expect(row?.pendingJobId).toBe(queued[0]!.id);
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
    const [other] = await db
      .insert(routines)
      .values({
        botId: bot.id,
        name: "other",
        prompt: "Other thing.",
        schedule: { kind: "cron", expr: "0 9 * * 1-5" },
      })
      .returning();
    vi.mocked(runtime.createConversation)
      .mockResolvedValueOnce(ROUTINE_CONVERSATION)
      .mockResolvedValueOnce(43);
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    await dispatchOccurrence(payloadOf(other!.id, SLOT), ON_TIME);
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

    expect(await db.$count(routineRuns, eq(routineRuns.routineId, routine.id))).toBe(1);
    expect(vi.mocked(runtime.submit).mock.calls).toHaveLength(1);
    expect(await sentJobs()).toHaveLength(1);
  });

  it("a crash between submit and chaining is repaired by the redelivery", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    // Simulate the crash: the row kept awaiting status but the chain never queued.
    await db.update(routines).set({ pendingJobId: null }).where(eq(routines.id, routine.id));
    await db.delete(jobs);

    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    expect(await sentJobs()).toHaveLength(1); // chain repaired
    expect(vi.mocked(runtime.submit).mock.calls).toHaveLength(1); // no duplicate submit
  });

  it("a job the queue retries after a crash past the submit repairs the chain", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    // The delivering job is still the pending handle: the crash came before
    // the next occurrence was queued.
    const [delivering] = await db
      .insert(jobs)
      .values({ id: "job-retried", name: ROUTINE_FIRE_JOB, state: "active", runAt: SLOT })
      .returning();
    await db
      .update(routines)
      .set({ nextRunAt: SLOT, pendingJobId: delivering!.id })
      .where(eq(routines.id, routine.id));
    await db.insert(routineRuns).values({
      routineId: routine.id,
      scheduledFor: SLOT,
      status: "awaiting",
      requestId: runRequestId(routine.id, SLOT),
      submittedAt: ON_TIME,
    });

    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME, delivering!.id);

    expect(vi.mocked(runtime.submit)).not.toHaveBeenCalled();
    const row = await routineRow(routine.id);
    expect(row?.nextRunAt?.toISOString()).toBe("2026-10-22T03:30:00.000Z");
    expect(row?.pendingJobId).not.toBe(delivering!.id);
    expect((await sentJobs()).filter((job) => job.state === "created")).toHaveLength(1);
  });

  it("an overdue occurrence beyond grace is recorded missed and never submitted", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" }); // grace 120m
    const veryLate = new Date(SLOT.getTime() + 3 * 60 * 60_000);
    await dispatchOccurrence(payloadOf(routine.id, SLOT), veryLate);

    const run = await runOf(routine.id);
    expect(run).toMatchObject({ status: "missed" });
    expect(vi.mocked(runtime.submit)).not.toHaveBeenCalled();
    // Backlog collapses: the next job schedules from now, not from the stale slot.
    expect(await sentJobs()).toHaveLength(1);
    const row = await routineRow(routine.id);
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

    const run = await runOf(routine.id);
    expect(run?.status).toBe("awaiting");
    const text = vi.mocked(runtime.submit).mock.calls[0]![1].text as string;
    expect(text).toContain("(late by 5m)");
    // A fired once archives itself.
    const row = await routineRow(routine.id);
    expect(row).toMatchObject({ enabled: false, nextRunAt: null, pendingJobId: null });
    expect(await sentJobs()).toHaveLength(0);
  });

  it("a deleted routine (orphan job) acks and exits", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    const id = routine.id;
    await db.delete(routines).where(eq(routines.id, id));
    await expect(dispatchOccurrence(payloadOf(id, SLOT), ON_TIME)).resolves.toBeUndefined();
    expect(vi.mocked(runtime.submit)).not.toHaveBeenCalled();
  });

  it("a job racing a pause is a phantom fire and does not submit", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await db
      .update(routines)
      .set({ enabled: false, nextRunAt: null, pendingJobId: null })
      .where(eq(routines.id, routine.id));
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    expect(vi.mocked(runtime.submit)).not.toHaveBeenCalled();
    expect(await db.$count(routineRuns)).toBe(0);
  });

  it("manual trigger on a paused routine still fires", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await db
      .update(routines)
      .set({ enabled: false, nextRunAt: null, pendingJobId: null })
      .where(eq(routines.id, routine.id));
    await dispatchOccurrence(payloadOf(routine.id, SLOT, "manual"), ON_TIME);
    expect(vi.mocked(runtime.submit)).toHaveBeenCalledTimes(1);
    // Manual runs never touch the chain.
    expect(await sentJobs()).toHaveLength(0);
  });

  it("two Run now clicks in the same second are two runs", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    const first = await runNow(routine.id);
    const second = await runNow(routine.id);
    expect(first.runId).not.toBe("");
    expect(second.runId).not.toBe(first.runId);
    expect(vi.mocked(runtime.submit)).toHaveBeenCalledTimes(2);
  });

  it("a submit failure fails the run once and pauses the routine, leaving the chat alone", async () => {
    const { bot, routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await db.update(routines).set({ pendingJobId: "job-99" }).where(eq(routines.id, routine.id));
    const failing = fakeRuntime({
      submit: vi.fn<AgentRuntime["submit"]>().mockRejectedValue(new Error("model gone")),
    });
    installFakeRuntime(failing);
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await runOf(routine.id, SLOT);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("model gone");
    // The failed run's card says the routine paused; nothing is written to the chat.
    expect(run?.error).toContain("paused");
    const after = await routineRow(routine.id);
    expect(after?.enabled).toBe(false);
    expect(after?.pendingJobId).toBeNull();
    expect(after?.nextRunAt).toBeNull();
    expect(await sentJobs()).toHaveLength(0); // no chain after a failed submit
    expect(vi.mocked(failing.submit).mock.calls.map(([ref]) => ref)).toEqual([
      ROUTINE_CONVERSATION,
    ]);
    expect(await chatCards(bot.id, bot.chatStartedAt)).toEqual([
      expect.objectContaining({ id: run!.id, status: "failed" }),
    ]);
  });

  it("a model removed from the catalog pauses the routine instead of retrying", async () => {
    // The reconcile before submit is where a vanished model throws
    // (ModelNotFoundError); it must take the same fail-once path as submit.
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    const failing = fakeRuntime({
      configure: vi
        .fn<AgentRuntime["configure"]>()
        .mockRejectedValue(new Error('Unknown model "m1"')),
    });
    installFakeRuntime(failing);
    const runId = await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await runOf(routine.id, SLOT);
    expect(runId).toBe(run?.id);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("Unknown model");
    expect((await routineRow(routine.id))?.enabled).toBe(false);
  });
});

describe("completion watcher", () => {
  let runtime: ReturnType<typeof fakeRuntime>;

  /** The run's turn finished with this reply. */
  function answer(run: { requestId: string }, reply: Omit<FinishedReply, "createdAt">) {
    runtime.script.answer(run.requestId, reply, ROUTINE_CONVERSATION);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    runtime = fakeRuntime();
    installFakeRuntime(runtime);
    await clearTables();
  });

  afterEach(clearTables);

  it("marks a run succeeded with a 2000-char preview when the reply lands", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await runOf(routine.id);
    answer(run!, { text: "x".repeat(2500) });
    const watcher = createRoutinesCompletionWatcher(runtime);
    const resolved = await watcher.resolveConversation(ROUTINE_CONVERSATION);
    expect(resolved).toBe(1);

    const after = await runById(run!.id);
    expect(after?.status).toBe("succeeded");
    expect(after?.output?.length).toBe(2000);
    expect(after?.finishedAt).toBeTruthy();
  });

  it("the owner chatting meanwhile never answers the run: only its own conversation does", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await runOf(routine.id);
    answer(run!, { text: "Routine's answer" });
    // The answer sits in the routine's conversation; the chat has none.
    const watcher = createRoutinesCompletionWatcher(runtime);

    expect(await watcher.resolveConversation(CHAT)).toBe(0);
    expect((await runById(run!.id))?.status).toBe("awaiting");
    expect(await watcher.resolveConversation(ROUTINE_CONVERSATION)).toBe(1);
    expect(await runById(run!.id)).toMatchObject({
      status: "succeeded",
      output: "Routine's answer",
    });
  });

  it("a refused ask tool marks the run blocked, naming the tool and how to allow it", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await runOf(routine.id);
    // The turn's refusals are collected across its messages by the runtime.
    answer(run!, { text: "Drafted the email but could not send it.", refused: ["send_email"] });
    const watcher = createRoutinesCompletionWatcher(runtime);
    expect(await watcher.resolveConversation(ROUTINE_CONVERSATION)).toBe(1);

    expect(await runById(run!.id)).toMatchObject({
      status: "blocked",
      error: "Needs approval for `send_email`; set it to Allow for this bot to use it in routines.",
      output: "Drafted the email but could not send it.",
    });
  });

  /** Fire the next hourly slot and resolve it with `reply` (issue #87 helpers). */
  async function runOnce(routineId: string, hour: number, reply: Omit<FinishedReply, "createdAt">) {
    const slot = new Date(SLOT.getTime() + hour * 60 * 60_000);
    await dispatchOccurrence(payloadOf(routineId, slot), new Date(slot.getTime() + 5_000));
    const run = (await runOf(routineId, slot))!;
    answer(run, reply);
    await createRoutinesCompletionWatcher(runtime).resolveConversation(ROUTINE_CONVERSATION);
    return (await runById(run.id))!;
  }

  it("a run that reports itself blocked is recorded blocked with its reason (#87)", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "interval", minutes: 60 });
    const run = await runOnce(routine.id, 0, {
      text: "Nothing processed: no Gmail access.",
      blocked: "Needs a vault login for the Gmail account",
    });
    expect(run).toMatchObject({
      status: "blocked",
      error: "Needs a vault login for the Gmail account",
      output: "Nothing processed: no Gmail access.",
    });
    expect((await routineRow(routine.id))!.blockedStreak).toBe(1);
  });

  it("three blocked runs in a row pause the routine and say why; a good run resets the count (#87)", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "interval", minutes: 60 });
    const blocked = { text: "Blocked.", blocked: "Needs a vault login" };

    await runOnce(routine.id, 0, blocked);
    await runOnce(routine.id, 1, { text: "All done." });
    expect((await routineRow(routine.id))!.blockedStreak).toBe(0);

    await runOnce(routine.id, 2, blocked);
    await runOnce(routine.id, 3, blocked);
    let row = (await routineRow(routine.id))!;
    expect(row).toMatchObject({ enabled: true, blockedStreak: 2, pausedReason: null });

    await runOnce(routine.id, 4, blocked);
    row = (await routineRow(routine.id))!;
    expect(row).toMatchObject({
      enabled: false,
      blockedStreak: 3,
      pausedReason: "Paused after 3 blocked runs: Needs a vault login",
    });
    expect(row.nextRunAt).toBeNull();
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
    const run = await runOf(routine.id);
    // An awaiting run has no card yet.
    expect(await chatCards(bot.id, bot.chatStartedAt)).toEqual([]);

    const seen: { botId: string; card: RoutineRunCard }[] = [];
    const stop = onRoutineCard((botId, card) => seen.push({ botId, card }));
    answer(run!, { text: "**All** good" });
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
    expect(await chatCards(bot.id, bot.chatStartedAt)).toEqual([expect.objectContaining(card)]);
    // A thread started after the run ("New chat") does not show it.
    expect(await chatCards(bot.id, new Date(Date.now() + 1000))).toEqual([]);
  });

  it("a model error reply marks the run failed", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await runOf(routine.id);
    answer(run!, { text: "", error: "Model error: gateway down" });
    const watcher = createRoutinesCompletionWatcher(runtime);
    await watcher.resolveConversation(ROUTINE_CONVERSATION);

    const after = await runById(run!.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("Model error");
  });

  it("two awaiting runs on one conversation each get their own reply", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await db
      .update(routines)
      .set({ conversationId: String(ROUTINE_CONVERSATION) })
      .where(eq(routines.id, routine.id));
    const [first] = await db
      .insert(routineRuns)
      .values({
        routineId: routine.id,
        scheduledFor: new Date("2026-10-21T03:30:00Z"),
        status: "awaiting",
        requestId: "routine:x:1",
        submittedAt: new Date("2026-10-21T03:30:01Z"),
      })
      .returning();
    const [second] = await db
      .insert(routineRuns)
      .values({
        routineId: routine.id,
        scheduledFor: new Date("2026-10-22T03:30:00Z"),
        status: "awaiting",
        requestId: "routine:x:2",
        submittedAt: new Date("2026-10-22T03:30:01Z"),
      })
      .returning();
    answer(first!, { text: "First reply" });
    answer(second!, { text: "Second reply" });
    const watcher = createRoutinesCompletionWatcher(runtime);
    const resolved = await watcher.resolveConversation(ROUTINE_CONVERSATION);
    expect(resolved).toBe(2);
    const afterFirst = await runById(first!.id);
    const afterSecond = await runById(second!.id);
    expect(afterFirst?.output).toBe("First reply");
    expect(afterSecond?.output).toBe("Second reply");
  });

  it("a run whose turn has not finished keeps awaiting", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await runOf(routine.id);

    const watcher = createRoutinesCompletionWatcher(runtime);
    expect(await watcher.resolveConversation(ROUTINE_CONVERSATION)).toBe(0);
    expect((await runById(run!.id))?.status).toBe("awaiting");
  });

  it("boot sweep resolves a run whose reply finished just before the restart", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await runOf(routine.id);
    answer(run!, { text: "Done before the restart" });

    expect(await createRoutinesCompletionWatcher(runtime).bootSweep()).toBe(1);
    expect(await runById(run!.id)).toMatchObject({
      status: "succeeded",
      output: "Done before the restart",
    });
  });

  it("boot sweep marks awaiting runs on idle conversations interrupted", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await runOf(routine.id);

    const watcher = createRoutinesCompletionWatcher(runtime);
    const resolved = await watcher.bootSweep();
    expect(resolved).toBe(1);
    const after = await runById(run!.id);
    expect(after).toMatchObject({ status: "failed", error: "interrupted" });
  });

  it("boot sweep leaves runs on busy conversations for the idle listener", async () => {
    const { routine } = await seedBotAndRoutine({ kind: "cron", expr: "0 9 * * 1-5" });
    await dispatchOccurrence(payloadOf(routine.id, SLOT), ON_TIME);
    const run = await runOf(routine.id);

    const busyRuntime = fakeRuntime({
      isBusy: vi.fn<AgentRuntime["isBusy"]>().mockReturnValue(true),
    });
    const watcher = createRoutinesCompletionWatcher(busyRuntime);
    const resolved = await watcher.bootSweep();
    expect(resolved).toBe(0);
    const after = await runById(run!.id);
    expect(after?.status).toBe("awaiting");
  });
});
