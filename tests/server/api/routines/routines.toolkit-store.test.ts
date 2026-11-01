/**
 * The app-side RoutineStore adapter (issue #18 phase C): the recursion guard
 * rejects mutations from a routine's own conversation (issue #63; list stays
 * open) and never from the owner's chat, creates validate the schedule like the API, sourceKey
 * makes a replayed create return the same routine, and every save path
 * renders the sentence and next 3 IST fire times. Real SQLite test DB; arming
 * queues on the real jobs table (no worker runs in tests).
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { addJob } from "@groot/jobs/server/queue";
import { db, jobs, routineRuns, routines } from "../../../../apps/web/src/server/db";
import { ROUTINE_FIRE_JOB } from "../../../../apps/web/src/server/api/routines/routines.chain";
import {
  createRoutineStore,
  RECURSION_MSG,
} from "../../../../apps/web/src/server/api/routines/routines.toolkit-store";
import { resetAppTables, seedBot as seedBotRow } from "../../fixtures";

const CONVERSATION = 7;
/** The routine's own conversation, where its runs happen (issue #63). */
const ROUTINE_CONVERSATION = 70;

const seedBot = (name = "Bot", conversationId = String(CONVERSATION)) =>
  seedBotRow({ name, conversationId });

async function seedRoutine(botId: string, conversationId?: number) {
  const [routine] = await db
    .insert(routines)
    .values({
      botId,
      name: "digest",
      prompt: "Do the thing.",
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
      enabled: true,
      ...(conversationId !== undefined ? { conversationId: String(conversationId) } : {}),
    })
    .returning();
  return routine!;
}

/** A run of the routine waiting for its reply in the routine's conversation. */
async function seedAwaitingRun(routineId: string) {
  const at = new Date("2026-10-21T03:30:00.000Z");
  const [run] = await db
    .insert(routineRuns)
    .values({
      routineId,
      scheduledFor: at,
      status: "awaiting",
      trigger: "schedule",
      requestId: `routine:${routineId}:${at.toISOString()}`,
      submittedAt: new Date(),
    })
    .returning();
  return run!;
}

async function routineRow(id: string) {
  return db.query.routines.findFirst({ where: eq(routines.id, id) });
}

const clearTables = resetAppTables;

describe("routines toolkit store adapter", () => {
  let store: ReturnType<typeof createRoutineStore>;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = createRoutineStore();
    await clearTables();
  });

  afterEach(clearTables);

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
    const row = await routineRow(routine.id);
    expect(row?.botId).toBe(bot.id);
    expect(row?.sourceKey).toBe("pi:sess:1");
    expect(row?.enabled).toBe(true);
    expect(row?.nextRunAt).toBeTruthy();
  });

  // One-time routines must be in the future, so date them next year rather
  // than on a fixed day that eventually passes.
  const NEXT_YEAR = new Date().getUTCFullYear() + 1;

  it("a create with the same idempotency key returns the same routine", async () => {
    await seedBot();
    const first = await store.create(CONVERSATION, {
      idempotencyKey: "pi:sess:7",
      name: "once",
      prompt: "Remind me.",
      schedule: { kind: "once", at: `${NEXT_YEAR}-11-01T09:00:00+05:30` },
    });
    const second = await store.create(CONVERSATION, {
      idempotencyKey: "pi:sess:7",
      name: "once (replayed)",
      prompt: "Different args on a replay.",
      schedule: { kind: "cron", expr: "0 10 * * *" },
    });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("once");
    expect(await db.$count(routines)).toBe(1);
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
        schedule: { kind: "once", at: `${NEXT_YEAR}-11-01T09:00:00` },
      }),
    ).rejects.toThrow(/explicit offset/);
    expect(await db.$count(routines)).toBe(0);
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
    expect(await db.$count(routines, eq(routines.name, "loop"))).toBe(0);
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
    expect(await routineRow(routine.id)).toMatchObject({ enabled: true });

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
    const pendingJobId = await addJob(ROUTINE_FIRE_JOB, {}, { delaySeconds: 1800 });
    const [routine] = await db
      .insert(routines)
      .values({
        botId: bot.id,
        name: "doomed",
        prompt: "bye",
        schedule: { kind: "interval", minutes: 30 },
        enabled: true,
        pendingJobId,
      })
      .returning();
    await expect(store.remove(CONVERSATION, routine!.id)).resolves.toBe(true);
    expect(await routineRow(routine!.id)).toBeUndefined();
    const [job] = await db.select().from(jobs).where(eq(jobs.id, pendingJobId));
    expect(job?.state).toBe("cancelled");
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
