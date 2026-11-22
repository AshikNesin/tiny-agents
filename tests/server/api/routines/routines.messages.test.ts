import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { bots, db, routineRuns, routines } from "../../../../apps/web/src/server/db";
import { dispatchOccurrence } from "../../../../apps/web/src/server/api/routines/routines.jobs";
import { createRoutineRunResolver } from "../../../../apps/web/src/server/api/routines/routines.runs";
import { createTestApp } from "../../helpers";
import {
  authToken,
  createFakeRuntime,
  installFakeRuntime,
  resetAppTables,
  type FakeRuntime,
} from "../../fixtures";

const token = await authToken("routine-messages@example.com");
const RUN_CONVERSATION = 42;
const SLOT = new Date("2026-10-21T03:30:00.000Z");

describe("how often a routine messages the owner", () => {
  let runtime: FakeRuntime;

  beforeEach(async () => {
    vi.clearAllMocks();
    runtime = createFakeRuntime();
    runtime.createConversation.mockResolvedValue(RUN_CONVERSATION);
    installFakeRuntime(runtime);
    await resetAppTables();
  });

  afterEach(resetAppTables);

  async function runOnce(routineId: string, at: Date, sent: string[]) {
    await dispatchOccurrence(
      { routineId, scheduledFor: at.toISOString(), trigger: "manual" },
      new Date(at.getTime() + 1000),
    );
    const run = await db.query.routineRuns.findFirst({
      where: eq(routineRuns.scheduledFor, at),
    });
    runtime.script.answer(
      run!.requestId,
      { text: "done", ...(sent.length > 0 ? { sent } : {}) },
      RUN_CONVERSATION,
    );
    await createRoutineRunResolver(runtime).resolveConversation(RUN_CONVERSATION);
    return db.query.routineRuns.findFirst({ where: eq(routineRuns.id, run!.id) });
  }

  it("records each run's messages and shows the rate on the routine", async () => {
    const [bot] = await db
      .insert(bots)
      .values({ name: "Bot", modelId: "m1", conversationId: "7", chatStartedAt: SLOT })
      .returning();
    const [routine] = await db
      .insert(routines)
      .values({
        botId: bot!.id,
        name: "prices",
        prompt: "Check prices.",
        schedule: { kind: "cron", expr: "0 9 * * *" },
      })
      .returning();

    const loud = await runOnce(routine!.id, SLOT, ["Price dropped", "And another"]);
    expect(loud).toMatchObject({ status: "succeeded", messages: 2 });
    const quiet = await runOnce(routine!.id, new Date(SLOT.getTime() + 3600_000), []);
    expect(quiet).toMatchObject({ status: "succeeded", messages: 0 });
    await db.insert(routineRuns).values({
      routineId: routine!.id,
      scheduledFor: new Date(SLOT.getTime() - 3600_000),
      status: "succeeded",
      requestId: "before-the-column",
    });

    const response = await createTestApp().request("/api/v1/routines", {
      headers: { authorization: `Bearer ${token}` },
    });
    const list = ((await response.json()) as { data: { messageRate: unknown }[] }).data;
    expect(list[0]!.messageRate).toEqual({ runs: 2, messaged: 1 });
  });
});
