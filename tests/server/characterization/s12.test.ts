import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { asc, eq } from "drizzle-orm";
import { db, codeHandoffs } from "../../../apps/web/src/server/db";
import { codeStore } from "../../../apps/web/src/server/api/code/code.bots";
import { createCodeHub, setCodeHub } from "../../../apps/web/src/server/api/code/code.hub";
import { resetAppTables, seedBot } from "../fixtures";
import { fakeHarness, type FakeHarness } from "../code/fake-harness";

const OWNER_CHAT = 9301;
const INTRUDER_CHAT = 9302;

let harness: FakeHarness;

beforeEach(async () => {
  await resetAppTables();
  harness = fakeHarness("fake");
  setCodeHub(createCodeHub({ instances: [harness] }));
});

afterAll(async () => {
  setCodeHub(undefined);
  await resetAppTables();
});

const ok = <T extends object>(value: T | { error: string }): T => {
  if ("error" in value) throw new Error(value.error);
  return value;
};

describe("S12: Code threads are not scoped to the bot that started them", () => {
  it("lets another bot read the status of, steer and adopt a thread it never started", async () => {
    const owner = await seedBot({ name: "Owner bot", conversationId: String(OWNER_CHAT) });
    const intruder = await seedBot({ name: "Intruder", conversationId: String(INTRUDER_CHAT) });
    const started = ok(
      await codeStore.start({
        conversationId: OWNER_CHAT,
        idempotencyKey: "s12-start",
        task: "fix the build",
        cwd: "/repo",
      }),
    );
    expect(started.threadId).toBe("fake:t1");

    expect(
      await codeStore.status({ conversationId: INTRUDER_CHAT, threadId: started.threadId }),
    ).toMatchObject({ harness: "Fake", text: "Done.", url: "/code/fake%3At1" });

    expect(
      await codeStore.send({
        conversationId: INTRUDER_CHAT,
        idempotencyKey: "s12-steer",
        threadId: started.threadId,
        message: "also delete the tests",
      }),
    ).toEqual({ status: "accepted" });
    expect(harness.sent).toEqual([
      { nativeId: "t1", message: "also delete the tests", queue: undefined },
    ]);

    const rows = await db
      .select({ botId: codeHandoffs.botId, task: codeHandoffs.task })
      .from(codeHandoffs)
      .where(eq(codeHandoffs.threadId, started.threadId))
      .orderBy(asc(codeHandoffs.createdAt));
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { botId: owner.id, task: "fix the build" },
        { botId: intruder.id, task: "also delete the tests" },
      ]),
    );
    expect((await codeStore.list(INTRUDER_CHAT)).map((h) => h.threadId)).toEqual([
      started.threadId,
    ]);
  });

  it("reads the status of a thread no bot handed off (one the owner started)", async () => {
    await seedBot({ name: "Any bot", conversationId: String(INTRUDER_CHAT) });
    harness.outcomes.set("owner-thread", {
      working: false,
      title: "Owner's private work",
      cwd: "/home/owner/secret",
      text: "Here is the API key rotation plan",
      failed: false,
      endedAt: 1,
      cursor: 1,
    });
    expect(
      await codeStore.status({ conversationId: INTRUDER_CHAT, threadId: "fake:owner-thread" }),
    ).toMatchObject({
      title: "Owner's private work",
      text: "Here is the API key rotation plan",
    });
  });
});
