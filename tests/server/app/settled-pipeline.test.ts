/**
 * The settled pipeline on the real faux-backed runtime, started the way boot
 * starts it (entry.node.ts): a lifecycle whose "agent runtime" part opens
 * the runtime and whose "settled conversations" part starts
 * `startSettledPipeline` on it. bots-settled.test.ts keeps `settle`'s
 * ordering and isolation cases.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { AgentRuntime } from "@tiny-agents/agent";
import { createLifecycle, type Lifecycle } from "../../../apps/web/src/server/lifecycle";
import { createDeliveries } from "../../../apps/web/src/server/api/bots/bots.delivery";
import { startSettledPipeline } from "../../../apps/web/src/server/api/bots/bots.settled";
import type { Notifier } from "../../../apps/web/src/server/api/notifications/notifications.wiring";
import { db, botMessages, bots } from "../../../apps/web/src/server/db";
import { closeAppRuntime, openAppRuntime, resetAppTables, seedBot, until } from "../fixtures";

const quiet = { info: () => undefined, warn: () => undefined };

/** Run notifications go nowhere here (notifications.wiring.test.ts covers them). */
const silentNotifier = {
  notify: () => undefined,
  cancel: () => undefined,
  getSettings: async () => ({ longRunMinutes: 1_000, reminderMinutes: 0 }),
  defineEvents: () => undefined,
} as unknown as Notifier;

/** Boot's composition, against a faux runtime slow enough that a target is still replying after a submit. */
function boot(): { lifecycle: Lifecycle; runtime: () => AgentRuntime } {
  const lifecycle = createLifecycle({ log: quiet, exit: () => undefined });
  let runtime!: AgentRuntime;
  lifecycle.add({
    name: "agent runtime",
    start: async () => {
      runtime = await openAppRuntime({ tokensPerSecond: 40 });
    },
    stop: () => closeAppRuntime(),
  });
  let stopSettled = () => {};
  lifecycle.add({
    name: "settled conversations",
    start: () => {
      stopSettled = startSettledPipeline(runtime, { notifier: silentNotifier });
    },
    stop: () => stopSettled(),
  });
  return { lifecycle, runtime: () => runtime };
}

const ledgerRow = (requestId: string) =>
  db.query.botMessages.findFirst({ where: eq(botMessages.requestId, requestId) });

const mention = (
  host: { id: string; name: string },
  to: string,
  requestId: string,
  text: string,
) => ({
  requestId,
  kind: "mention" as const,
  toBotId: to,
  fromBotId: null,
  replyToBotId: host.id,
  text,
  prompt: text,
  peer: { kind: "mention" as const, hostName: host.name },
});

describe("the settled pipeline, started as boot starts it", () => {
  let booted: ReturnType<typeof boot>;

  beforeEach(async () => {
    await resetAppTables();
    booted = boot();
    await booted.lifecycle.start();
  });

  afterEach(async () => {
    await booted.lifecycle.stop("test");
    await resetAppTables();
  });

  it(
    "relays a Delivery's Finished reply that arrives after the submit",
    { timeout: 15_000 },
    async () => {
      const rt = booted.runtime();
      const host = await seedBot({ name: "Host" });
      const guest = await seedBot({ name: "Guest" });
      const guestRef = Number(guest.conversationId);
      const text = "tell me something long enough to take a while";
      expect(await createDeliveries(rt).deliver(mention(host, guest.id, "slow", text))).toEqual({
        status: "delivered",
        queued: false,
      });
      // The fast path saw the target busy: only its settling can answer.
      expect(rt.isBusy(guestRef)).toBe(true);

      await until(async () => (await ledgerRow("slow"))?.answeredAt != null, "the answer");
      const hostChat = await rt.readChat(Number(host.conversationId));
      expect(hostChat.messages.map((m) => m.text)).toContain(`**Reply from Guest:** Echo: ${text}`);
      expect(await ledgerRow("slow")).toMatchObject({
        kind: "relay",
        conversationId: String(guestRef),
      });
      // The same settling folded the guest's reply into the bot list.
      const guestRow = await db.query.bots.findFirst({ where: eq(bots.id, guest.id) });
      expect(guestRow?.lastMessagePreview).toBe(`Echo: ${text}`);
      // Answering again is a no-op: one answer per Delivery.
      expect(await createDeliveries(rt).answer(guestRef)).toBe(0);
    },
  );
});

describe("the settled pipeline's boot sweeps", () => {
  afterEach(async () => {
    await closeAppRuntime();
    await resetAppTables();
  });

  it("answer, once it listens, a Delivery whose reply finished while nothing listened", async () => {
    await resetAppTables();
    const rt = await openAppRuntime();
    const host = await seedBot({ name: "Host" });
    const guest = await seedBot({ name: "Guest" });
    const guestRef = Number(guest.conversationId);
    // As before a restart: the target replied, the Delivery stayed unanswered.
    await rt.submit(guestRef, { requestId: "left-over", text: "hi" });
    await until(async () => (await rt.readChat(guestRef)).messages.length >= 2, "the reply");
    await until(() => !rt.isBusy(guestRef), "the guest to settle");
    await db.insert(botMessages).values({
      fromBotId: null,
      toBotId: guest.id,
      conversationId: guest.conversationId,
      replyToBotId: host.id,
      kind: "mention",
      requestId: "left-over",
      text: "hi",
      deliveredAt: new Date(),
    });

    const stop = startSettledPipeline(rt, { notifier: silentNotifier });
    try {
      await until(async () => (await ledgerRow("left-over"))?.answeredAt != null, "the sweep");
      const hostChat = await rt.readChat(Number(host.conversationId));
      expect(hostChat.messages.map((m) => m.text)).toContain("**Reply from Guest:** Echo: hi");
    } finally {
      stop();
    }
  });
});
