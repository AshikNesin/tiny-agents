import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { bots, db, routineRuns, routines } from "../../../../apps/web/src/server/db";
import { dispatchOccurrence } from "../../../../apps/web/src/server/api/routines/routines.jobs";
import { createRoutineStore } from "../../../../apps/web/src/server/api/routines/routines.toolkit-store";
import { createTestApp } from "../../helpers";
import {
  authToken,
  createFakeRuntime,
  installFakeRuntime,
  resetAppTables,
  type FakeRuntime,
} from "../../fixtures";

const token = await authToken("routine-progress@example.com");

const CHAT = 7;
const RUN_CONVERSATION = 42;
const SLOT = new Date("2026-10-21T03:30:00.000Z");
const ON_TIME = new Date("2026-10-21T03:30:05.000Z");

async function seed() {
  const [bot] = await db
    .insert(bots)
    .values({ name: "Bot", modelId: "m1", conversationId: String(CHAT), chatStartedAt: SLOT })
    .returning();
  const [routine] = await db
    .insert(routines)
    .values({
      botId: bot!.id,
      name: "reading list",
      prompt: "Summarize the next 5 links on the list.",
      schedule: { kind: "cron", expr: "0 9 * * *" },
    })
    .returning();
  await db.insert(routineRuns).values({
    routineId: routine!.id,
    scheduledFor: new Date(SLOT.getTime() - 24 * 60 * 60_000),
    status: "succeeded",
    requestId: "earlier",
    output: "Summarized links 1 to 5.",
    conversationId: String(RUN_CONVERSATION),
  });
  return routine!;
}

const progressOf = async (id: string) =>
  (await db.query.routines.findFirst({ where: eq(routines.id, id) }))?.progress;

describe("routine progress note", () => {
  let runtime: FakeRuntime;

  beforeEach(async () => {
    vi.clearAllMocks();
    runtime = createFakeRuntime();
    runtime.createConversation.mockResolvedValue(99);
    installFakeRuntime(runtime);
    await resetAppTables();
  });

  afterEach(resetAppTables);

  it("a routine run saves its note; a chat cannot", async () => {
    const routine = await seed();
    const store = createRoutineStore();
    expect(await store.saveProgress(RUN_CONVERSATION, "  Done: links 1-5. Next: 6.  ")).toBe(true);
    expect(await progressOf(routine.id)).toBe("Done: links 1-5. Next: 6.");
    expect(await store.saveProgress(CHAT, "planted")).toBe(false);
    expect(await progressOf(routine.id)).toBe("Done: links 1-5. Next: 6.");
    expect(await store.saveProgress(RUN_CONVERSATION, "   ")).toBe(true);
    expect(await progressOf(routine.id)).toBeNull();
  });

  it("the next run reads the note instead of quoting earlier results", async () => {
    const routine = await seed();
    await createRoutineStore().saveProgress(RUN_CONVERSATION, "Done: links 1-5. Next: 6.");
    await dispatchOccurrence(
      { routineId: routine.id, scheduledFor: SLOT.toISOString(), trigger: "schedule" },
      ON_TIME,
    );
    const text = runtime.submit.mock.calls[0]![1].text;
    expect(text).toContain("Your progress note from earlier runs");
    expect(text).toContain("Done: links 1-5. Next: 6.");
    expect(text).not.toContain("Summarized links 1 to 5.");
  });

  it("without a note the run still quotes earlier results", async () => {
    const routine = await seed();
    await dispatchOccurrence(
      { routineId: routine.id, scheduledFor: SLOT.toISOString(), trigger: "schedule" },
      ON_TIME,
    );
    const text = runtime.submit.mock.calls[0]![1].text;
    expect(text).toContain("Summarized links 1 to 5.");
    expect(text).not.toContain("progress note");
  });

  it("the owner reads it on the routine and can clear it", async () => {
    const routine = await seed();
    await createRoutineStore().saveProgress(RUN_CONVERSATION, "Next: 6.");
    const app = createTestApp();
    const read = await app.request(`/api/v1/routines/${routine.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await read.json()).toMatchObject({ data: { progress: "Next: 6." } });
    const cleared = await app.request(`/api/v1/routines/${routine.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ progress: null }),
    });
    expect(cleared.status).toBe(200);
    expect(await progressOf(routine.id)).toBeNull();
  });
});
