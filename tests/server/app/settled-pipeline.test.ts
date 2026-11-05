/**
 * The settled pipeline as boot composes it: a lifecycle whose "agent
 * runtime" part opens the runtime and whose "settled conversations" part
 * wires the steps, on the real faux-backed runtime.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { AgentRuntime } from "@tiny-agents/agent";
import { createLifecycle, type Lifecycle } from "../../../apps/web/src/server/lifecycle";
import { createDeliveries } from "../../../apps/web/src/server/api/bots/bots.delivery";
import { onConversationSettled } from "../../../apps/web/src/server/api/bots/bots.settled";
import { db, botMessages } from "../../../apps/web/src/server/db";
import { closeAppRuntime, openAppRuntime, resetAppTables, seedBot, until } from "../fixtures";

const quiet = { info: () => undefined, warn: () => undefined };

/** Boot's composition (entry.node.ts), against the faux runtime. */
function boot(): { lifecycle: Lifecycle; runtime: () => AgentRuntime } {
  const lifecycle = createLifecycle({ log: quiet, exit: () => undefined });
  const add = lifecycle.add;
  let runtime!: AgentRuntime;
  add({
    name: "agent runtime",
    // Slow enough that a Delivery's target is still replying after the submit.
    start: async () => {
      runtime = await openAppRuntime({ tokensPerSecond: 40 });
    },
    stop: () => closeAppRuntime(),
  });
  let unsubscribe = () => {};
  add({
    name: "settled conversations",
    start: () => {
      const deliveries = createDeliveries(runtime);
      unsubscribe = onConversationSettled(runtime, [
        { name: "deliveries", run: (c) => deliveries.answer(c.conversationId, c.chat) },
      ]);
      void deliveries.sweep().catch(() => undefined);
    },
    stop: () => unsubscribe(),
  });
  return { lifecycle, runtime: () => runtime };
}

const ledgerRow = (requestId: string) =>
  db.query.botMessages.findFirst({ where: eq(botMessages.requestId, requestId) });

describe("the settled pipeline, wired as boot wires it", () => {
  let booted: ReturnType<typeof boot>;

  beforeEach(async () => {
    booted = boot();
    await booted.lifecycle.start();
    await resetAppTables();
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
      const outcome = await createDeliveries(rt).deliver({
        requestId: "slow-mention",
        kind: "mention",
        toBotId: guest.id,
        fromBotId: null,
        replyToBotId: host.id,
        text: "tell me something long enough to take a while",
        prompt: "tell me something long enough to take a while",
        peer: { kind: "mention", hostName: host.name },
      });
      expect(outcome).toMatchObject({ status: "delivered" });
      // The fast path saw the target busy: only its settling can answer.
      expect(rt.isBusy(Number(guest.conversationId))).toBe(true);

      await until(async () => (await ledgerRow("slow-mention"))?.answeredAt != null, "the answer");
      const hostChat = await rt.readChat(Number(host.conversationId));
      expect(hostChat.messages.map((m) => m.text)).toContain(
        "**Reply from Guest:** Echo: tell me something long enough to take a while",
      );
    },
  );
});
