import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db, memories } from "../../../apps/web/src/server/db";
import { api, createTestApp, type TestApp } from "../helpers";
import { authToken, resetAppTables, seedBot } from "../fixtures";

const token = await authToken("c21@example.com");

type MemoryBody = { memory: { id: string; text: string; status: string } };
type MemoryList = { memories: Array<{ id: string; text: string; status: string }> };

let app: TestApp;

beforeEach(async () => {
  await resetAppTables();
  app = createTestApp();
});

afterEach(resetAppTables);

const add = (botId: string, text: string) =>
  api<MemoryBody>(app, `/api/v1/bots/${botId}/memories`, {
    method: "POST",
    json: { text, category: "preference" },
    token,
  });

describe("C21: Memory page writes outside the ledger's rules", () => {
  it("lands an edit into another memory's text on that memory (fixed)", async () => {
    const bot = await seedBot({ name: "Memory bot", conversationId: "9901" });
    const tea = await add(bot.id, "Likes tea");
    const coffee = await add(bot.id, "Likes coffee");
    expect(tea.status).toBe(201);
    expect(coffee.status).toBe(201);

    const edited = await api<MemoryBody>(app, `/api/v1/memories/${coffee.body.data!.memory.id}`, {
      method: "PATCH",
      json: { text: "likes tea" },
      token,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data!.memory.id).toBe(tea.body.data!.memory.id);
    const listed = await api<MemoryList>(app, `/api/v1/bots/${bot.id}/memories`, { token });
    expect(listed.body.data!.memories.map((m) => [m.text, m.status]).sort()).toEqual([
      ["Likes coffee", "superseded"],
      ["likes tea", "active"],
    ]);
  });

  it("marks a due memory expired in the database while answering a GET", async () => {
    const bot = await seedBot({ name: "Memory bot", conversationId: "9902" });
    const [due] = await db
      .insert(memories)
      .values({
        botId: bot.id,
        text: "On holiday this week",
        category: "fact",
        source: "manual",
        status: "active",
        until: new Date(Date.now() - 60_000),
      })
      .returning();
    expect(due!.status).toBe("active");

    const listed = await api<MemoryList>(app, `/api/v1/bots/${bot.id}/memories`, { token });
    expect(listed.status).toBe(200);
    expect(listed.body.data!.memories).toEqual([]);

    const after = await db.query.memories.findFirst({ where: eq(memories.id, due!.id) });
    expect(after?.status).toBe("expired");
  });
});
