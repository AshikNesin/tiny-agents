/**
 * Characterization of behavior-register row U6: the turn budget (3 messages)
 * is in memory and resets on every idle.
 * Preserve: this pins today's behavior, quirk included; change it only with a
 * signed-off register row.
 *
 * `turnBudgetOf(rt)` (bots.messaging.ts) is a Map in a WeakMap keyed by the
 * runtime object: every store on one runtime shares it, a new runtime (a
 * restart) starts from zero whatever the ledger holds, and the settled
 * pipeline (bots.settled.ts) clears a conversation's count on any
 * `busy: false` activity for it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { AgentRuntime } from "@tiny-agents/agent";
import { botMessages, db } from "../../../apps/web/src/server/db";
import { createBotMessagingStore } from "../../../apps/web/src/server/api/bots/bots.messaging";
import { startSettledPipeline } from "../../../apps/web/src/server/api/bots/bots.settled";
import {
  createFakeRuntime,
  installFakeRuntime,
  resetAppTables,
  seedBot,
  type FakeRuntime,
} from "../fixtures";

const SENDER_CHAT = 10_601;
/** TURN_LIMIT in bots.messaging.ts. */
const TURN_LIMIT = 3;

let runtime: FakeRuntime;
let stopPipeline: (() => void) | undefined;

/** A fake whose targets are busy, so no fast answer runs behind a delivery. */
function busyFake(): FakeRuntime {
  const fake = createFakeRuntime();
  fake.isBusy.mockReturnValue(true);
  return fake;
}

beforeEach(async () => {
  runtime = installFakeRuntime(busyFake());
  await resetAppTables();
  await seedBot({ name: "Sender", conversationId: String(SENDER_CHAT) });
  for (let i = 1; i <= 8; i++) await seedBot({ name: `Target ${i}`, conversationId: `1060${i}0` });
});

afterEach(async () => {
  stopPipeline?.();
  stopPipeline = undefined;
  await resetAppTables();
});

let n = 0;
const send = (store: ReturnType<typeof createBotMessagingStore>, target: number) => {
  n += 1;
  return store.deliver({
    conversationId: SENDER_CHAT,
    toName: `Target ${target}`,
    text: "hi",
    requestId: `u6-${n}`,
    sourceKey: `sk-u6-${n}`,
  });
};

describe("U6: the per-turn message budget lives in memory", () => {
  it("is shared per runtime object, forgotten by a new one, and cleared by any idle", async () => {
    const store = createBotMessagingStore(runtime);
    for (let t = 1; t <= TURN_LIMIT; t++) {
      expect(await send(store, t)).toMatchObject({ delivered: true });
    }
    expect(await send(store, 4)).toEqual({ delivered: false, reason: "budget" });

    // A second store on the same runtime shares the count.
    expect(await send(createBotMessagingStore(runtime), 4)).toEqual({
      delivered: false,
      reason: "budget",
    });

    // A new runtime object (as after a restart) starts from zero, although
    // the ledger already holds this turn's three sends.
    expect(await db.$count(botMessages)).toBe(TURN_LIMIT);
    expect(await send(createBotMessagingStore(busyFake()), 4)).toMatchObject({
      delivered: true,
    });

    // Back on the first runtime: still spent until the conversation idles.
    expect(await send(store, 5)).toEqual({ delivered: false, reason: "budget" });
    stopPipeline = startSettledPipeline(runtime as unknown as AgentRuntime);
    // An idle with no busy before it still resets the count.
    runtime.emitActivity({ busy: false, conversation: SENDER_CHAT });
    for (let t = 5; t < 5 + TURN_LIMIT; t++) {
      expect(await send(store, t)).toMatchObject({ delivered: true });
    }
    expect(await send(store, 8)).toEqual({ delivered: false, reason: "budget" });
  });
});
