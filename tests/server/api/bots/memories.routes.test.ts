import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { bots, db, memories } from "../../../../apps/web/src/server/db";
import { api, createTestApp, type TestApp } from "../../helpers";
import {
  authToken,
  closeAppRuntime,
  openAppRuntime,
  resetAppTables,
  TEST_MODEL,
} from "../../fixtures";

const token = await authToken("memories-test@example.com");

type MemoryList = { memories: Array<Record<string, unknown>> };

async function seedBot(app: TestApp): Promise<string> {
  const response = await api<{ id: string }>(app, "/api/v1/bots", {
    method: "POST",
    json: { name: "Memory bot", modelId: TEST_MODEL },
    token,
  });
  expect(response.status).toBe(201);
  return response.body.data!.id;
}

function addMemory(app: TestApp, botId: string, json: Record<string, unknown>) {
  return api<{ memory: { id: string } }>(app, `/api/v1/bots/${botId}/memories`, {
    method: "POST",
    json,
    token,
  });
}

function listMemories(app: TestApp, botId: string, query = "") {
  return api<MemoryList>(app, `/api/v1/bots/${botId}/memories${query}`, { token });
}

function findBot(id: string) {
  return db.query.bots.findFirst({ where: eq(bots.id, id) });
}

describe("Memories API routes", () => {
  let app: TestApp;

  beforeEach(async () => {
    await openAppRuntime();
    await resetAppTables();
    app = createTestApp();
  });

  afterEach(closeAppRuntime);

  it("creates a manual memory and lists it", async () => {
    const botId = await seedBot(app);
    expect(
      (
        await addMemory(app, botId, {
          text: "Prefers TypeScript over JavaScript",
          category: "preference",
        })
      ).status,
    ).toBe(201);

    const list = await listMemories(app, botId);
    expect(list.status).toBe(200);
    const rows = list.body.data!.memories;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      text: "Prefers TypeScript over JavaScript",
      category: "preference",
      status: "active",
      source: "manual",
    });
  });

  it("rejects invalid category and over-length text at the boundary", async () => {
    const botId = await seedBot(app);
    expect(
      (await addMemory(app, botId, { text: "x".repeat(301), category: "preference" })).status,
    ).toBe(400);
    expect((await addMemory(app, botId, { text: "ok", category: "vibe" })).status).toBe(400);
  });

  it("edits a memory and tombstones on delete; deleted rows leave the default list", async () => {
    const botId = await seedBot(app);
    const created = await addMemory(app, botId, { text: "Works at exe.dev", category: "fact" });
    expect(created.status).toBe(201);
    const id = created.body.data!.memory.id;

    const edited = await api(app, `/api/v1/memories/${id}`, {
      method: "PATCH",
      json: { text: "Works at exe.dev on Shelley" },
      token,
    });
    expect(edited.status).toBe(200);

    const removed = await api(app, `/api/v1/memories/${id}`, { method: "DELETE", token });
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ deleted: true });

    const list = await listMemories(app, botId);
    expect(list.status).toBe(200);
    expect(list.body.data!.memories).toHaveLength(0);

    const row = await db.query.memories.findFirst({ where: eq(memories.id, id) });
    expect(row?.status).toBe("deleted");
  });

  it("archives the oldest active rows past the budget", async () => {
    const botId = await seedBot(app);
    for (let i = 0; i < 61; i++) {
      await addMemory(app, botId, { text: `Fact number ${i}`, category: "fact" });
    }
    const list = await listMemories(app, botId, "?includeArchived=true");
    expect(list.status).toBe(200);
    const rows = list.body.data!.memories;
    expect(rows.filter((m) => m.status === "active")).toHaveLength(60);
    expect(rows.filter((m) => m.status === "archived")).toHaveLength(1);
    expect(rows.find((m) => m.status === "archived")).toMatchObject({ text: "Fact number 0" });
  });

  it("follows the ledger's rules: one row per text, and the owner may add a deleted one back", async () => {
    const botId = await seedBot(app);
    const first = await addMemory(app, botId, { text: "Works at exe.dev", category: "fact" });
    const id = first.body.data!.memory.id;
    const again = await addMemory(app, botId, { text: " works at EXE.dev ", category: "fact" });
    expect(again.status).toBe(201);
    expect(again.body.data!.memory).toMatchObject({ id, text: "Works at exe.dev" });

    await api(app, `/api/v1/memories/${id}`, { method: "DELETE", token });
    const back = await addMemory(app, botId, { text: "Works at exe.dev", category: "fact" });
    expect(back.body.data!.memory).toMatchObject({ id, status: "active", source: "manual" });
    expect(await db.$count(memories, eq(memories.botId, botId))).toBe(1);
    expect((await listMemories(app, botId)).body.data!.memories).toHaveLength(1);
  });

  it("merges an edit into the memory that already has its text, never a second active copy", async () => {
    const botId = await seedBot(app);
    const kept = (await addMemory(app, botId, { text: "Works at exe.dev", category: "fact" })).body
      .data!.memory.id;
    const edited = (await addMemory(app, botId, { text: "Likes tea", category: "preference" })).body
      .data!.memory.id;

    const response = await api<{ memory: Record<string, unknown> }>(
      app,
      `/api/v1/memories/${edited}`,
      { method: "PATCH", json: { text: "works at EXE.dev." }, token },
    );

    expect(response.status).toBe(200);
    expect(response.body.data!.memory).toMatchObject({ id: kept, status: "active" });
    const active = (await listMemories(app, botId)).body.data!.memories.filter(
      (m) => m.status === "active",
    );
    expect(active.map((m) => m.id)).toEqual([kept]);
    const old = await db.query.memories.findFirst({ where: eq(memories.id, edited) });
    expect(old).toMatchObject({ status: "superseded", supersededById: kept, text: "Likes tea" });
  });

  it("restores an archived memory and keeps it past a full budget", async () => {
    const botId = await seedBot(app);
    await db.insert(memories).values({
      botId,
      text: "Archived long ago",
      category: "fact",
      status: "archived",
      source: "manual",
      createdAt: new Date(10),
    });
    await db.insert(memories).values(
      Array.from({ length: 60 }, (_, i) => ({
        botId,
        text: `Fact number ${i}`,
        category: "fact",
        source: "manual",
        createdAt: new Date(1_000 + i),
      })),
    );
    const archived = await db.query.memories.findFirst({
      where: eq(memories.text, "Archived long ago"),
    });
    const restored = await api<{ memory: { status: string } }>(
      app,
      `/api/v1/memories/${archived!.id}`,
      { method: "PATCH", json: { restore: true }, token },
    );
    expect(restored.status).toBe(200);
    expect(restored.body.data!.memory.status).toBe("active");
    const rows = (await listMemories(app, botId, "?includeArchived=true")).body.data!.memories;
    expect(rows.filter((m) => m.status === "active")).toHaveLength(60);
    expect(rows.find((m) => m.status === "archived")).toMatchObject({ text: "Fact number 0" });
  });

  it("flips expired rows out of the active list", async () => {
    const botId = await seedBot(app);
    await db.insert(memories).values({
      botId,
      text: "Is traveling this week",
      category: "fact",
      status: "active",
      source: "manual",
      until: new Date("2020-01-01T00:00:00.000Z"),
    });
    const list = await listMemories(app, botId, "?includeArchived=true");
    expect(list.status).toBe(200);
    const statuses = list.body.data!.memories.map((m) => m.status);
    expect(statuses).not.toContain("active");
    expect(statuses).toContain("expired");
  });

  it("treats the string 'false' as false for includeArchived", async () => {
    const botId = await seedBot(app);
    await db.insert(memories).values({
      botId,
      text: "Archived one",
      category: "fact",
      status: "archived",
      source: "manual",
    });
    const list = await listMemories(app, botId, "?includeArchived=false");
    expect(list.status).toBe(200);
    expect(list.body.data!.memories).toHaveLength(0);
  });

  it("404s for a missing bot and a missing memory", async () => {
    const botId = await seedBot(app);
    expect((await listMemories(app, "nope")).status).toBe(404);
    expect((await addMemory(app, botId, { text: "ok", category: "fact" })).status).toBe(201);
    const missing = await api(app, "/api/v1/memories/nope", {
      method: "PATCH",
      json: { text: "x" },
      token,
    });
    expect(missing.status).toBe(404);
  });

  it("toggles memoryEnabled through the existing bot update path", async () => {
    const botId = await seedBot(app);
    const off = await api<{ memoryEnabled: boolean }>(app, `/api/v1/bots/${botId}`, {
      method: "PATCH",
      json: { memoryEnabled: false },
      token,
    });
    expect(off.status).toBe(200);
    expect(off.body.data!.memoryEnabled).toBe(false);
    const row = await findBot(botId);
    expect(row?.memoryEnabled).toBe(false);
  });

  it("starts capture from now when memory is turned back on", async () => {
    const botId = await seedBot(app);
    const old = new Date("2026-01-01T00:00:00.000Z");
    await db
      .update(bots)
      .set({ memoryEnabled: false, memoryCapturedThrough: old })
      .where(eq(bots.id, botId));
    const before = Date.now();
    const on = await api(app, `/api/v1/bots/${botId}`, {
      method: "PATCH",
      json: { memoryEnabled: true },
      token,
    });
    expect(on.status).toBe(200);
    const row = await findBot(botId);
    expect(row?.memoryEnabled).toBe(true);
    // What was said while memory was off is behind the watermark now.
    expect(row!.memoryCapturedThrough!.getTime()).toBeGreaterThanOrEqual(before);

    // Re-sending "on" while already on leaves the watermark alone.
    const stamped = row!.memoryCapturedThrough!.getTime();
    const onAgain = await api(app, `/api/v1/bots/${botId}`, {
      method: "PATCH",
      json: { memoryEnabled: true },
      token,
    });
    expect(onAgain.status).toBe(200);
    const again = await findBot(botId);
    expect(again!.memoryCapturedThrough!.getTime()).toBe(stamped);
  });
});
