import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { botMessages, db } from "../../../apps/web/src/server/db";
import { createDeliveries } from "../../../apps/web/src/server/api/bots/bots.delivery";
import {
  createBotMessagingStore,
  turnBudgetOf,
} from "../../../apps/web/src/server/api/bots/bots.messaging";
import {
  createFakeRuntime,
  installFakeRuntime,
  resetAppTables,
  seedBot,
  type FakeRuntime,
} from "../fixtures";

const SENDER_CHAT = 9501;
const TARGET_CHAT = 9502;
const LOOP_LIMIT = 8;

let runtime: FakeRuntime;

beforeEach(async () => {
  runtime = installFakeRuntime(createFakeRuntime());
  runtime.isBusy.mockReturnValue(true);
  await resetAppTables();
  await seedBot({ name: "Sender", conversationId: String(SENDER_CHAT) });
  await seedBot({ name: "Target", conversationId: String(TARGET_CHAT) });
});

afterEach(resetAppTables);

async function send(store: ReturnType<typeof createBotMessagingStore>, n: number) {
  turnBudgetOf(runtime).reset(SENDER_CHAT);
  return store.deliver({
    conversationId: SENDER_CHAT,
    toName: "Target",
    text: `message ${n}`,
    requestId: `c8-${n}`,
    sourceKey: `sk-c8-${n}`,
  });
}

describe("C8: answered sends stop counting toward the loop guard", () => {
  it("lets a 9th send through when the first 8 were answered (their rows became relay)", async () => {
    const store = createBotMessagingStore(runtime);
    const deliveries = createDeliveries(runtime);
    for (let n = 1; n <= LOOP_LIMIT; n++) {
      expect(await send(store, n)).toMatchObject({ delivered: true });
      const row = await db.query.botMessages.findFirst({
        where: eq(botMessages.requestId, `c8-${n}`),
      });
      const answeredIn = Number(row!.conversationId);
      runtime.script.answer(`c8-${n}`, { text: `answer ${n}` }, answeredIn);
      expect(await deliveries.answer(answeredIn)).toBe(1);
    }
    const kinds = (await db.select({ kind: botMessages.kind }).from(botMessages)).map(
      (r) => r.kind,
    );
    expect(kinds).toEqual(Array(LOOP_LIMIT).fill("relay"));

    expect(await send(store, LOOP_LIMIT + 1)).toMatchObject({ delivered: true });
    expect(await send(store, LOOP_LIMIT + 2)).toMatchObject({ delivered: true });
    const row = await db.query.botMessages.findFirst({
      where: eq(botMessages.requestId, `c8-${LOOP_LIMIT + 1}`),
    });
    expect(row?.kind).toBe("send");
  });

  it("trips only while the earlier sends are still unanswered", async () => {
    const store = createBotMessagingStore(runtime);
    for (let n = 1; n <= LOOP_LIMIT; n++) {
      expect(await send(store, n)).toMatchObject({ delivered: true });
    }
    expect(await send(store, LOOP_LIMIT + 1)).toEqual({ delivered: false, reason: "loop" });
  });
});
