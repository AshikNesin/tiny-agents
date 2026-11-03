/**
 * The `shelley_*` tools' store (issue #143): starts are idempotent per
 * durable tool task, everything is scoped to the bot that owns the asking
 * conversation, and a follow-up re-arms the finish delivery.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { createShelleyToolkit } from "../../../../packages/agent/src/toolkits/shelley";
import { db, bots, shelleyHandoffs } from "../../../../apps/web/src/server/db";
import { shelleyStore } from "../../../../apps/web/src/server/api/shelley/shelley.store";
import {
  finishHandoffOnce,
  isFollowed,
} from "../../../../apps/web/src/server/api/shelley/shelley.service";
import { resetAppTables, TEST_MODEL } from "../../fixtures";
import { startFakeShelley, type FakeShelley } from "./fake-shelley";

let shelley: FakeShelley;

beforeAll(async () => {
  shelley = await startFakeShelley();
  process.env.SHELLEY_URL = shelley.url;
});
afterAll(async () => {
  delete process.env.SHELLEY_URL;
  await shelley.close();
});
beforeEach(async () => {
  await resetAppTables();
  shelley.seen.length = 0;
  await db.insert(bots).values([
    { name: "Coder", modelId: TEST_MODEL, conversationId: "101" },
    { name: "Other", modelId: TEST_MODEL, conversationId: "202" },
  ]);
});

describe("Shelley hand-off store", () => {
  it("starts once per tool task and follows the conversation", async () => {
    const first = await shelleyStore.start({
      conversationId: 101,
      idempotencyKey: "task-1",
      task: "fix the login test",
      cwd: "/repo",
    });
    const replay = await shelleyStore.start({
      conversationId: 101,
      idempotencyKey: "task-1",
      task: "fix the login test",
      cwd: "/repo",
    });
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      status: "running",
      cwd: "/repo",
      url: `/code/${first.conversationId}`,
    });
    expect(shelley.seen.filter((s) => s.url === "/api/conversations/new")).toHaveLength(1);
    expect(JSON.parse(shelley.seen[0].body.toString())).toEqual({
      message: "fix the login test",
      cwd: "/repo",
    });
    expect(await isFollowed(first.conversationId)).toBe(true);
    expect((await shelleyStore.list(101)).map((h) => h.conversationId)).toEqual([
      first.conversationId,
    ]);
  });

  it("keeps each bot to its own hand-offs, and re-arms a finished one on follow-up", async () => {
    const handoff = await shelleyStore.start({
      conversationId: 101,
      idempotencyKey: "task-2",
      task: "t",
    });
    expect(
      await shelleyStore.send({
        conversationId: 202,
        shelleyConversationId: handoff.conversationId,
        message: "x",
      }),
    ).toEqual({ error: "not_found" });
    expect(
      await shelleyStore.status({
        conversationId: 202,
        shelleyConversationId: handoff.conversationId,
      }),
    ).toBeUndefined();

    const [row] = await db
      .select()
      .from(shelleyHandoffs)
      .where(eq(shelleyHandoffs.shelleyConversationId, handoff.conversationId));
    expect(await finishHandoffOnce(row.id)).toBe(true);
    expect(await finishHandoffOnce(row.id)).toBe(false);
    expect(
      await shelleyStore.send({
        conversationId: 101,
        shelleyConversationId: handoff.conversationId,
        message: "also logout",
        queue: true,
      }),
    ).toEqual({ status: "queued" });
    const [after] = await db.select().from(shelleyHandoffs).where(eq(shelleyHandoffs.id, row.id));
    expect(after.status).toBe("running");
  });

  it("reports status with the working tree's changed files", async () => {
    const handoff = await shelleyStore.start({
      conversationId: 101,
      idempotencyKey: "task-3",
      task: "t",
      cwd: "/repo",
    });
    const status = await shelleyStore.status({
      conversationId: 101,
      shelleyConversationId: handoff.conversationId,
    });
    expect(status).toMatchObject({ working: true, url: `/code/${handoff.conversationId}` });
    expect(status?.changedFiles).toEqual([
      { path: "math.js", status: "modified", additions: 4, deletions: 0, isGenerated: false },
    ]);
  });
});

describe("shelley toolkit", () => {
  it("offers its tools only when Shelley is configured", () => {
    const off = createShelleyToolkit({ setupHint: "Set SHELLEY_URL" });
    expect(off.setupHint).toBe("Set SHELLEY_URL");
    expect(off.extension.tools ?? []).toHaveLength(0);
    const on = createShelleyToolkit({ store: shelleyStore });
    expect((on.extension.tools ?? []).map((t) => t.name)).toEqual([
      "shelley_start",
      "shelley_send",
      "shelley_status",
      "shelley_list",
    ]);
    // Starting and steering run code on Shelley's machine: they ask first.
    expect(on.tools.filter((t) => !t.readOnly).map((t) => t.name)).toEqual([
      "shelley_start",
      "shelley_send",
    ]);
  });
});
