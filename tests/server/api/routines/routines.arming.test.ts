/**
 * A routine's armed state (routines.arming.ts): each transition is one
 * compare-and-set write, the handle a write replaces is cancelled, and a job
 * queued for a write that lost is cancelled too, so a routine never keeps two
 * chains. Real SQLite test DB and the real queue table (no worker runs).
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { db, jobs, routines } from "../../../../apps/web/src/server/db";
import {
  BLOCKED_RUNS_BEFORE_PAUSE,
  ROUTINE_FIRE_JOB,
  advanceRoutine,
  armRoutine,
  setLatestConversation,
  clearBlockedStreak,
  createRoutine,
  disarmRoutine,
  moveToBot,
  recordBlocked,
  removeRoutine,
} from "../../../../apps/web/src/server/api/routines/routines.arming";
import { createRoutineStore } from "../../../../apps/web/src/server/api/routines/routines.toolkit-store";
import type { Schedule } from "../../../../apps/web/src/server/api/routines/routines.schedule";
import { resetAppTables, seedBot } from "../../fixtures";

const HOURLY: Schedule = { kind: "interval", minutes: 60 };
const NOW = new Date();

async function fireJobs() {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.name, ROUTINE_FIRE_JOB))
    .orderBy(sql`rowid`);
}
async function liveJobIds() {
  return (await fireJobs()).filter((job) => job.state === "created").map((job) => job.id);
}
async function row(id: string) {
  return (await db.query.routines.findFirst({ where: eq(routines.id, id) }))!;
}

let botId = "";
async function armed(fields: { sourceKey?: string } = {}) {
  const { id } = await createRoutine(
    { botId, name: "digest", prompt: "Do it.", schedule: HOURLY, ...fields },
    true,
    NOW,
  );
  return row(id);
}

beforeEach(async () => {
  await resetAppTables();
  botId = (await seedBot({ conversationId: "7" })).id;
});
afterEach(resetAppTables);

describe("createRoutine", () => {
  it("inserts the routine already armed, carrying its sourceKey", async () => {
    const routine = await armed({ sourceKey: "pi:1" });
    expect(routine).toMatchObject({ enabled: true, sourceKey: "pi:1" });
    expect(routine.nextRunAt!.getTime()).toBe(NOW.getTime() + 60 * 60_000);
    expect(await liveJobIds()).toEqual([routine.pendingJobId]);
  });

  it("a paused create queues nothing", async () => {
    const { id } = await createRoutine({ botId, name: "p", prompt: "p", schedule: HOURLY }, false);
    expect(await row(id)).toMatchObject({ enabled: false, nextRunAt: null, pendingJobId: null });
    expect(await fireJobs()).toHaveLength(0);
  });

  it("a replayed sourceKey returns the first routine and cancels its own job", async () => {
    const first = await armed({ sourceKey: "pi:2" });
    const again = await createRoutine(
      { botId, name: "replayed", prompt: "x", schedule: HOURLY, sourceKey: "pi:2" },
      true,
    );
    expect(again).toEqual({ id: first.id, created: false });
    expect(await db.$count(routines)).toBe(1);
    expect(await liveJobIds()).toEqual([first.pendingJobId]);
  });

  it("toolkit creates replayed at once make one routine (no duplicate)", async () => {
    const store = createRoutineStore();
    const input = {
      idempotencyKey: "pi:sess:race",
      name: "digest",
      prompt: "Summarize.",
      schedule: HOURLY,
    };
    const [a, b] = await Promise.all([store.create(7, input), store.create(7, input)]);
    expect(b.id).toBe(a.id);
    expect(await db.$count(routines)).toBe(1);
    expect(await liveJobIds()).toEqual([(await row(a.id)).pendingJobId]);
  });
});

describe("arm and disarm", () => {
  it("arming replaces the chain, cancels the old job and starts the blocked count over", async () => {
    const routine = await armed();
    await db
      .update(routines)
      .set({ blockedStreak: 2, pausedReason: "old" })
      .where(eq(routines.id, routine.id));
    await armRoutine(routine.id, HOURLY, NOW);
    const after = await row(routine.id);
    expect(after).toMatchObject({ enabled: true, blockedStreak: 0, pausedReason: null });
    expect(after.pendingJobId).not.toBe(routine.pendingJobId);
    expect(await liveJobIds()).toEqual([after.pendingJobId]);
  });

  it("disarming cancels the job and clears the slot", async () => {
    const routine = await armed();
    await disarmRoutine(routine.id);
    expect(await row(routine.id)).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pendingJobId: null,
    });
    expect(await liveJobIds()).toEqual([]);
  });

  it("arming a routine that is gone leaves no job behind", async () => {
    await armRoutine("missing", HOURLY, NOW);
    expect(await liveJobIds()).toEqual([]);
  });

  it("removing cancels the job and hands back the conversation to retire", async () => {
    const routine = await armed();
    await setLatestConversation(routine.id, "70");
    expect(await removeRoutine(routine.id)).toBe("70");
    expect(await db.$count(routines)).toBe(0);
    expect(await liveJobIds()).toEqual([]);
  });
});

describe("advanceRoutine", () => {
  it("moves the chain to the next occurrence while the handle is the one it loaded", async () => {
    const routine = await armed();
    await advanceRoutine(routine, routine.nextRunAt!, NOW);
    const after = await row(routine.id);
    expect(after.nextRunAt!.getTime()).toBe(routine.nextRunAt!.getTime() + 60 * 60_000);
    expect(after.pendingJobId).not.toBe(routine.pendingJobId);
  });

  it("an owner edit that landed meanwhile wins: the queued job is cancelled", async () => {
    const loaded = await armed();
    await armRoutine(loaded.id, HOURLY, NOW);
    const edited = await row(loaded.id);
    await advanceRoutine(loaded, loaded.nextRunAt!, NOW);
    expect(await row(loaded.id)).toMatchObject({
      pendingJobId: edited.pendingJobId,
      nextRunAt: edited.nextRunAt,
    });
    expect(await liveJobIds()).toEqual([edited.pendingJobId]);
  });

  it("a pause that landed meanwhile is not undone", async () => {
    const loaded = await armed();
    await disarmRoutine(loaded.id);
    await advanceRoutine(loaded, loaded.nextRunAt!, NOW);
    expect(await row(loaded.id)).toMatchObject({ enabled: false, pendingJobId: null });
    expect(await liveJobIds()).toEqual([]);
  });

  it("a fired once routine ends", async () => {
    const at = new Date(NOW.getTime() + 60_000);
    const { id } = await createRoutine(
      { botId, name: "once", prompt: "o", schedule: { kind: "once", at: at.toISOString() } },
      true,
      NOW,
    );
    await advanceRoutine(await row(id), at, NOW);
    expect(await row(id)).toMatchObject({ enabled: false, nextRunAt: null, pendingJobId: null });
  });
});

describe("blocked runs", () => {
  it("counts blocked runs and pauses in the same write once enough are in a row", async () => {
    const routine = await armed();
    for (let i = 1; i < BLOCKED_RUNS_BEFORE_PAUSE; i++) {
      expect(await recordBlocked(routine.id, "needs approval")).toBeNull();
    }
    const reason = await recordBlocked(routine.id, "needs approval");
    expect(reason).toBe(`Paused after ${BLOCKED_RUNS_BEFORE_PAUSE} blocked runs: needs approval`);
    expect(await row(routine.id)).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pendingJobId: null,
      blockedStreak: BLOCKED_RUNS_BEFORE_PAUSE,
      pausedReason: reason,
    });
    expect(await liveJobIds()).toEqual([]);
  });

  it("a paused routine (a manual run) only counts", async () => {
    const routine = await armed();
    await disarmRoutine(routine.id);
    await db.update(routines).set({ blockedStreak: 5 }).where(eq(routines.id, routine.id));
    expect(await recordBlocked(routine.id, "x")).toBeNull();
    expect(await row(routine.id)).toMatchObject({ blockedStreak: 6, pausedReason: null });
  });

  it("another outcome clears the streak", async () => {
    const routine = await armed();
    await recordBlocked(routine.id, "x");
    await clearBlockedStreak(routine.id);
    expect((await row(routine.id)).blockedStreak).toBe(0);
  });
});

describe("the routine's conversation", () => {
  it("moving to another bot retires the conversation in the same write", async () => {
    const routine = await armed();
    await setLatestConversation(routine.id, "70");
    const other = await seedBot({ name: "Other", conversationId: "8" });
    expect(await moveToBot(routine.id, other.id)).toBe("70");
    expect(await row(routine.id)).toMatchObject({ botId: other.id, conversationId: null });
  });
});
