import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import type { AgentRuntime } from "@tiny-agents/agent";
import { db, jobs, routineRuns, routines } from "../../../apps/web/src/server/db";
import { dispatchOccurrence } from "../../../apps/web/src/server/api/routines/routines.jobs";
import { runNow } from "../../../apps/web/src/server/api/routines/routines.service";
import { ROUTINE_FIRE_JOB } from "../../../apps/web/src/server/api/routines/routines.arming";
import {
  createFakeRuntime,
  installFakeRuntime,
  resetAppTables,
  seedBot,
  type FakeRuntime,
} from "../fixtures";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

let runtime: FakeRuntime;

beforeEach(async () => {
  runtime = installFakeRuntime(createFakeRuntime());
  await resetAppTables();
});

afterEach(resetAppTables);

async function seedRoutine(schedule: unknown, armed: Partial<typeof routines.$inferInsert> = {}) {
  const bot = await seedBot({ name: "Bot", conversationId: "10701" });
  const [routine] = await db
    .insert(routines)
    .values({ botId: bot.id, name: "digest", prompt: "Do the thing.", schedule, ...armed })
    .returning();
  return routine!;
}

const routineRow = (id: string) => db.query.routines.findFirst({ where: eq(routines.id, id) });
const runsOf = (id: string) => db.select().from(routineRuns).where(eq(routineRuns.routineId, id));
const fireJobs = () => db.select().from(jobs).where(eq(jobs.name, ROUTINE_FIRE_JOB));

describe("U7: routine firing policy", () => {
  it("records one missed run for a slot 10 hours late and restarts the hourly chain from now", async () => {
    const routine = await seedRoutine({ kind: "interval", minutes: 60 }, { enabled: true });
    const now = new Date();
    const slot = new Date(now.getTime() - 10 * HOUR);

    await dispatchOccurrence(
      { routineId: routine.id, scheduledFor: slot.toISOString(), trigger: "schedule" },
      now,
    );

    const runs = await runsOf(routine.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "missed", scheduledFor: slot });
    expect(runtime.submit).not.toHaveBeenCalled();
    expect((await routineRow(routine.id))?.nextRunAt?.getTime()).toBe(now.getTime() + HOUR);
    const queued = await fireJobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.data).toMatchObject({
      scheduledFor: new Date(now.getTime() + HOUR).toISOString(),
    });
  });

  it("fires a once-routine 30 days after its time", async () => {
    const at = new Date(Date.now() - 30 * DAY);
    const routine = await seedRoutine({ kind: "once", at: at.toISOString() }, { enabled: true });

    await dispatchOccurrence(
      { routineId: routine.id, scheduledFor: at.toISOString(), trigger: "schedule" },
      new Date(),
    );

    expect(await runsOf(routine.id)).toEqual([
      expect.objectContaining({ status: "awaiting", scheduledFor: at }),
    ]);
    expect(runtime.submit).toHaveBeenCalledTimes(1);
    expect(runtime.submit.mock.calls[0]![1].text).toContain("(late by 30 days)");
  });

  it("disarms an armed routine when a Run now submit fails", async () => {
    const routine = await seedRoutine(
      { kind: "cron", expr: "0 9 * * 1-5" },
      { enabled: true, nextRunAt: new Date(Date.now() + DAY), pendingJobId: "job-armed" },
    );
    installFakeRuntime(
      createFakeRuntime({
        submit: vi.fn<AgentRuntime["submit"]>().mockRejectedValue(new Error("gateway down")),
      }),
    );

    const { runId } = await runNow(routine.id);

    const [run] = await runsOf(routine.id);
    expect(run).toMatchObject({ id: runId, status: "failed", trigger: "manual" });
    expect(run!.error).toContain("gateway down");
    expect(await routineRow(routine.id)).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pendingJobId: null,
    });
  });
});
