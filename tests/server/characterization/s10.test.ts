/**
 * Characterization of behavior-register row S10: the routines toolkit lists
 * every bot's routines and can update or delete any routine id.
 * Preserve: this pins today's behavior, quirk included; change it only with a
 * signed-off register row.
 *
 * `createRoutineStore()` (routines.toolkit-store.ts): `list` ignores the
 * calling conversation, and `update`/`remove` only check that the caller is
 * not a routine's own conversation, never that the routine is the caller's.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db, routines } from "../../../apps/web/src/server/db";
import { createRoutineStore } from "../../../apps/web/src/server/api/routines/routines.toolkit-store";
import { installFakeRuntime, resetAppTables, seedBot } from "../fixtures";

const CALLER_CHAT = 9201;

async function seedRoutine(botId: string, name: string) {
  const [routine] = await db
    .insert(routines)
    .values({
      botId,
      name,
      prompt: `Prompt of ${name}`,
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
      enabled: false,
    })
    .returning();
  return routine!;
}

describe("S10: the routines toolkit reaches every bot's routines", () => {
  beforeEach(async () => {
    installFakeRuntime();
    await resetAppTables();
  });
  afterEach(resetAppTables);

  it("lists, updates and deletes another bot's routine from the caller's chat", async () => {
    const caller = await seedBot({ name: "Caller", conversationId: String(CALLER_CHAT) });
    const victim = await seedBot({ name: "Victim", conversationId: "9202" });
    const own = await seedRoutine(caller.id, "mine");
    const foreign = await seedRoutine(victim.id, "theirs");
    const store = createRoutineStore();

    // list: every bot's routines, not just the caller's.
    const listed = await store.list(CALLER_CHAT);
    expect(listed.map((r) => r.id).sort()).toEqual([own.id, foreign.id].sort());

    // update: another bot's routine, by id.
    const updated = await store.update(CALLER_CHAT, foreign.id, {
      name: "renamed by caller",
      prompt: "Caller's prompt",
    });
    expect(updated).toMatchObject({ id: foreign.id, name: "renamed by caller" });
    const row = await db.query.routines.findFirst({ where: eq(routines.id, foreign.id) });
    expect(row).toMatchObject({
      botId: victim.id,
      name: "renamed by caller",
      prompt: "Caller's prompt",
    });

    // remove: another bot's routine, by id.
    expect(await store.remove(CALLER_CHAT, foreign.id)).toBe(true);
    expect(await db.query.routines.findFirst({ where: eq(routines.id, foreign.id) })).toBe(
      undefined,
    );
    expect((await store.list(CALLER_CHAT)).map((r) => r.id)).toEqual([own.id]);
  });
});
