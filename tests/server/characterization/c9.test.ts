/**
 * Characterization of behavior-register row C9: relays land in the host
 * bot's current chat, not the chat that asked. A routine sender gets no relay.
 * Preserve: this pins today's behavior, quirk included; change it only with a
 * signed-off register row.
 *
 * The ledger row keeps only `replyToBotId`; the relay (bots.delivery.ts)
 * submits to that bot's row conversation as it is at answer time. A send
 * from one of the bot's routine runs is recorded with `replyToBotId = null`
 * (bots.messaging.ts), so its answer is marked answered and goes nowhere.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { botMessages, bots, db, routines } from "../../../apps/web/src/server/db";
import { createDeliveries } from "../../../apps/web/src/server/api/bots/bots.delivery";
import { createBotMessagingStore } from "../../../apps/web/src/server/api/bots/bots.messaging";
import {
  createFakeRuntime,
  installFakeRuntime,
  resetAppTables,
  seedBot,
  type FakeRuntime,
} from "../fixtures";

const ASKING_CHAT = 9601;
const NEW_CHAT = 9611;
const TARGET_CHAT = 9602;
const ROUTINE_CHAT = 9621;

let runtime: FakeRuntime;

beforeEach(async () => {
  runtime = installFakeRuntime(createFakeRuntime());
  // Busy target: nothing answers until the test calls `answer`.
  runtime.isBusy.mockReturnValue(true);
  await resetAppTables();
});

afterEach(resetAppTables);

const ledgerRow = (requestId: string) =>
  db.query.botMessages.findFirst({ where: eq(botMessages.requestId, requestId) });

describe("C9: where a relayed answer lands", () => {
  it("relays into the sender's current chat after it started a new one", async () => {
    const sender = await seedBot({ name: "Sender", conversationId: String(ASKING_CHAT) });
    await seedBot({ name: "Target", conversationId: String(TARGET_CHAT) });
    const store = createBotMessagingStore(runtime);
    expect(
      await store.deliver({
        conversationId: ASKING_CHAT,
        toName: "Target",
        text: "what's the status?",
        requestId: "c9-ask",
        sourceKey: "sk-c9-ask",
      }),
    ).toMatchObject({ delivered: true });

    // "New chat" on the sender before the target answers.
    await db
      .update(bots)
      .set({ conversationId: String(NEW_CHAT) })
      .where(eq(bots.id, sender.id));
    runtime.submit.mockClear();

    // The target answers in the conversation pinned on the row (its own).
    const row = await ledgerRow("c9-ask");
    const answeredIn = Number(row!.conversationId);
    expect(answeredIn).not.toBe(TARGET_CHAT);
    runtime.script.answer("c9-ask", { text: "all green" }, answeredIn);
    expect(await createDeliveries(runtime).answer(answeredIn)).toBe(1);

    expect(runtime.submit).toHaveBeenCalledTimes(1);
    const [conversation, input] = runtime.submit.mock.calls[0]!;
    expect(conversation).toBe(NEW_CHAT);
    expect(input).toMatchObject({
      requestId: `botmsg-reply-${row!.id}`,
      text: "**Reply from Target:** all green",
      peer: { kind: "reply", name: "Target" },
    });
    expect(runtime.submit.mock.calls.some(([ref]) => ref === ASKING_CHAT)).toBe(false);
  });

  it("gives a routine run's send no relay at all, though the row is answered", async () => {
    const sender = await seedBot({ name: "Sender", conversationId: String(ASKING_CHAT) });
    await seedBot({ name: "Target", conversationId: String(TARGET_CHAT) });
    await db.insert(routines).values({
      botId: sender.id,
      name: "digest",
      prompt: "Ask Target.",
      schedule: { kind: "interval", minutes: 60 },
      enabled: false,
      conversationId: String(ROUTINE_CHAT),
    });
    const store = createBotMessagingStore(runtime);
    expect(
      await store.deliver({
        conversationId: ROUTINE_CHAT,
        toName: "Target",
        text: "from the routine",
        requestId: "c9-routine",
        sourceKey: "sk-c9-routine",
      }),
    ).toMatchObject({ delivered: true });
    expect(await ledgerRow("c9-routine")).toMatchObject({ replyToBotId: null });
    runtime.submit.mockClear();

    const answeredIn = Number((await ledgerRow("c9-routine"))!.conversationId);
    runtime.script.answer("c9-routine", { text: "here you go" }, answeredIn);
    expect(await createDeliveries(runtime).answer(answeredIn)).toBe(1);

    expect(runtime.submit).not.toHaveBeenCalled();
    expect(await ledgerRow("c9-routine")).toMatchObject({
      kind: "relay",
      answeredAt: expect.any(Date),
    });
  });
});
