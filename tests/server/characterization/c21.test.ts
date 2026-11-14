/**
 * Characterization of behavior-register row C21: a memory edit on the Memory
 * page bypasses ledger dedupe, and `history()` writes expirations during a GET.
 * Preserve: this pins today's behavior, quirk included; change it only with a
 * signed-off register row.
 *
 * `PATCH /memories/:id` (memories.service.ts `update`) writes the new text
 * straight to the row, so two of a bot's memories can hold the same text,
 * which the ledger's `add` never allows. `GET /bots/:id/memories` calls
 * `memoryLedger().history()`, which first updates due rows to `expired`.
 */
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
  it("lets an edit give a memory the same text as another active one", async () => {
    const bot = await seedBot({ name: "Memory bot", conversationId: "9901" });
    const tea = await add(bot.id, "Likes tea");
    const coffee = await add(bot.id, "Likes coffee");
    expect(tea.status).toBe(201);
    expect(coffee.status).toBe(201);

    // Through the ledger, the same text (any case) lands on the existing row.
    const again = await add(bot.id, "LIKES TEA");
    expect(again.body.data!.memory.id).toBe(tea.body.data!.memory.id);
    expect(await db.$count(memories, eq(memories.botId, bot.id))).toBe(2);

    // Through an edit, it does not.
    const edited = await api<MemoryBody>(app, `/api/v1/memories/${coffee.body.data!.memory.id}`, {
      method: "PATCH",
      json: { text: "likes tea" },
      token,
    });
    expect(edited.status).toBe(200);
    const listed = await api<MemoryList>(app, `/api/v1/bots/${bot.id}/memories`, { token });
    // Both rows share the frozen createdAt, so compare without their order.
    expect(listed.body.data!.memories.map((m) => [m.text, m.status]).sort()).toEqual([
      ["Likes tea", "active"],
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
