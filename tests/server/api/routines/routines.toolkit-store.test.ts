/**
 * The app-side RoutineStore adapter (issue #18 phase C): the recursion guard
 * rejects mutations from a routine's own conversation (issue #63; list stays
 * open) and never from the owner's chat, creates validate the schedule like the API, sourceKey
 * makes a replayed create return the same routine, and every save path
 * renders the sentence and next 3 IST fire times. Real SQLite test DB; the
 * queue adapter is mocked so arming routines needs no live queue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";

vi.mock("@groot/jobs/server/client", () => ({
  getJobQueue: () => ({
    send: vi.fn(async () => `job-${Math.random().toString(36).slice(2)}`),
    cancelJob: vi.fn(async () => true),
    createQueue: vi.fn(async () => undefined),
  }),
  jobQueueReady: () => true,
}));

import {
  createRoutineStore,
  RECURSION_MSG,
} from "../../../../apps/web/src/server/api/routines/routines.toolkit-store";

const CONVERSATION = 7;
/** The routine's own conversation, where its runs happen (issue #63). */
const ROUTINE_CONVERSATION = 70;

async function seedBot(name = "Bot", conversationId = String(CONVERSATION)) {
  return prisma.bot.create({
    data: { name, modelId: "m1", conversationId },
  });
}

async function seedRoutine(botId: string, conversationId?: number) {
  return prisma.routine.create({
    data: {
      botId,
      name: "digest",
      prompt: "Do the thing.",
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
      enabled: true,
      ...(conversationId !== undefined ? { conversationId: String(conversationId) } : {}),
    },
  });
}

/** A run of the routine waiting for its reply in the routine's conversation. */
async function seedAwaitingRun(routineId: string) {
  const at = new Date("2026-10-21T03:30:00.000Z");
  return prisma.routineRun.create({
    data: {
      routineId,
      scheduledFor: at,
      status: "awaiting",
      trigger: "schedule",
      requestId: `routine:${routineId}:${at.toISOString()}`,
      submittedAt: new Date(),
    },
  });
}

describe("routines toolkit store adapter", () => {
  let store: ReturnType<typeof createRoutineStore>;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = createRoutineStore();
    await prisma.routineRun.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.bot.deleteMany();
  });

  afterEach(async () => {
    await prisma.routineRun.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.bot.deleteMany();
  });

  it("creates for the calling bot and renders sentence plus next 3 IST fires", async () => {
    const bot = await seedBot();
    const routine = await store.create(CONVERSATION, {
      idempotencyKey: "pi:sess:1",
      name: "weekday-digest",
      prompt: "Summarize HN.",
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
    });
    expect(routine.sentence).toBe("At 09:00, Monday through Friday");
    expect(routine.nextFireTimes).toHaveLength(3);
    expect(routine.nextFireTimes[0]).toMatch(/, 09:00 IST$/);
    expect(routine.enabled).toBe(true);
    const row = await prisma.routine.findUnique({ where: { id: routine.id } });
    expect(row?.botId).toBe(bot.id);
    expect(row?.sourceKey).toBe("pi:sess:1");
    expect(row?.enabled).toBe(true);
    expect(row?.nextRunAt).toBeTruthy();
  });

  it("a create with the same idempotency key returns the same routine", async () => {
    await seedBot();
    const first = await store.create(CONVERSATION, {
      idempotencyKey: "pi:sess:7",
      name: "once",
      prompt: "Remind me.",
      schedule: { kind: "once", at: "2026-11-01T09:00:00+05:30" },
    });
    const second = await store.create(CONVERSATION, {
      idempotencyKey: "pi:sess:7",
      name: "once (replayed)",
      prompt: "Different args on a replay.",
      schedule: { kind: "cron", expr: "0 10 * * *" },
    });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("once");
    expect(await prisma.routine.count()).toBe(1);
  });

  it("rejects schedules exactly like the API, with a readable reason", async () => {
    await seedBot();
    await expect(
      store.create(CONVERSATION, {
        idempotencyKey: "k",
        name: "too fast",
        prompt: "no",
        schedule: { kind: "interval", minutes: 5 },
      }),
    ).rejects.toThrow(/at least 15 minutes/);
    await expect(
      store.create(CONVERSATION, {
        idempotencyKey: "k2",
        name: "bad cron",
        prompt: "no",
        schedule: { kind: "cron", expr: "not a cron" },
      }),
    ).rejects.toThrow(/Not a valid cron expression/);
    await expect(
      store.create(CONVERSATION, {
        idempotencyKey: "k3",
        name: "bare wall clock",
        prompt: "no",
        schedule: { kind: "once", at: "2026-11-01T09:00:00" },
      }),
    ).rejects.toThrow(/explicit offset/);
    expect(await prisma.routine.count()).toBe(0);
  });

  it("rejects creates from a routine's own conversation (recursion guard)", async () => {
    const bot = await seedBot();
    await seedRoutine(bot.id, ROUTINE_CONVERSATION);
    await expect(
      store.create(ROUTINE_CONVERSATION, {
        idempotencyKey: "k",
        name: "loop",
        prompt: "no",
        schedule: { kind: "interval", minutes: 30 },
      }),
    ).rejects.toThrow(RECURSION_MSG);
    expect(await prisma.routine.count({ where: { name: "loop" } })).toBe(0);
  });

  it("update, delete, and run now are guarded too; list stays open", async () => {
    const bot = await seedBot();
    const routine = await seedRoutine(bot.id, ROUTINE_CONVERSATION);

    await expect(
      store.update(ROUTINE_CONVERSATION, routine.id, { enabled: false }),
    ).rejects.toThrow(RECURSION_MSG);
    await expect(store.remove(ROUTINE_CONVERSATION, routine.id)).rejects.toThrow(RECURSION_MSG);
    await expect(store.runNow(ROUTINE_CONVERSATION, routine.id)).rejects.toThrow(RECURSION_MSG);
    // The guard rejects before any effect: still enabled, still there.
    expect(await prisma.routine.findUnique({ where: { id: routine.id } })).toMatchObject({
      enabled: true,
    });

    const listed = await store.list(ROUTINE_CONVERSATION);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: routine.id,
      sentence: "At 09:00, Monday through Friday",
    });
  });

  it("the owner's chat manages routines while a run is working (issue #63)", async () => {
    const bot = await seedBot();
    const routine = await seedRoutine(bot.id, ROUTINE_CONVERSATION);
    await seedAwaitingRun(routine.id);
    const created = await store.create(CONVERSATION, {
      idempotencyKey: "k",
      name: "another",
      prompt: "ok",
      schedule: { kind: "interval", minutes: 30 },
    });
    expect(created.enabled).toBe(true);
    expect(await store.update(CONVERSATION, routine.id, { enabled: false })).toMatchObject({
      enabled: false,
    });
  });

  it("the guard keys on the calling conversation, not a neighbor bot", async () => {
    const busy = await seedBot("Busy", "1");
    const caller = await seedBot("Caller", "2");
    const routine = await seedRoutine(busy.id);
    await seedAwaitingRun(routine.id);
    const created = await store.create(2, {
      idempotencyKey: "k",
      name: "fine",
      prompt: "ok",
      schedule: { kind: "interval", minutes: 30 },
    });
    expect(created.enabled).toBe(true);
    expect(caller.id).toBeTruthy();
  });

  it("update with a new schedule re-arms and echoes fresh fire times", async () => {
    const bot = await seedBot();
    const routine = await seedRoutine(bot.id);
    const updated = await store.update(CONVERSATION, routine.id, {
      schedule: { kind: "cron", expr: "30 18 * * 5" },
    });
    expect(updated?.sentence).toContain("Friday");
    expect(updated?.nextFireTimes[0]).toMatch(/, 18:30 IST$/);
  });

  it("update and remove on a missing id report not-found, not a throw", async () => {
    await seedBot();
    await expect(store.update(CONVERSATION, "nope", { name: "x" })).resolves.toBeUndefined();
    await expect(store.remove(CONVERSATION, "nope")).resolves.toBe(false);
  });

  it("remove deletes the routine and cancels its pending job", async () => {
    const bot = await seedBot();
    const routine = await prisma.routine.create({
      data: {
        botId: bot.id,
        name: "doomed",
        prompt: "bye",
        schedule: { kind: "interval", minutes: 30 },
        enabled: true,
        pendingJobId: "job-42",
      },
    });
    await expect(store.remove(CONVERSATION, routine.id)).resolves.toBe(true);
    expect(await prisma.routine.findUnique({ where: { id: routine.id } })).toBeNull();
  });

  it("paused routines render no fire times and the paused marker rides along", async () => {
    const bot = await seedBot();
    const routine = await seedRoutine(bot.id);
    const paused = await store.update(CONVERSATION, routine.id, { enabled: false });
    expect(paused?.enabled).toBe(false);
    expect(paused?.nextFireTimes).toEqual([]);
    expect(paused?.nextRunAt).toBeNull();
  });
});
