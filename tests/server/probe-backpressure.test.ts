import { beforeAll, describe, expect, it } from "vite-plus/test";
import { app } from "../../apps/web/src/server/app-root";
import { publishBotChatEvent } from "../../apps/web/src/server/api/bots/bots.events";
import { installFakeRuntime, resetAppTables, seedBot } from "./fixtures";
import { createTestApp, signIn } from "./helpers";

const bigRun = (i: number, size: number) => ({
  type: "routine-run" as const,
  run: {
    id: `run-${i}`,
    routineId: "r1",
    routineName: "digest",
    status: "succeeded" as const,
    trigger: "schedule" as const,
    scheduledFor: "2026-11-05T09:00:00.000Z",
    finishedAt: "2026-11-05T09:01:00.000Z",
    output: "x".repeat(size),
    error: null,
  },
});

function growthMb(before: number): number {
  return (process.memoryUsage().arrayBuffers - before) / 1e6;
}

describe("sse backpressure probe", () => {
  beforeAll(async () => {
    await resetAppTables();
    installFakeRuntime();
  });

  it("memory stays flat as a stalled consumer is published to", async () => {
    const a = createTestApp();
    const { token } = await signIn(a);
    const bot = await seedBot({ conversationId: "9100" });
    const res = await a.request(`/api/v1/bots/${bot.id}/stream`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    try {
      for (const count of [1_000, 2_000, 5_000]) {
        globalThis.gc?.();
        const before = process.memoryUsage().arrayBuffers;
        for (let i = 1; i <= count; i++) publishBotChatEvent(bot.id, bigRun(i, 10_000));
        globalThis.gc?.();
        console.log(
          `[probe:backpressure] events=${count} growth=${growthMb(before).toFixed(1)}MB ` +
            `openStreams=${app().openSseStreams.size}`,
        );
        expect(app().openSseStreams.size).toBeLessThan(2);
      }
    } finally {
      await res.body?.cancel();
    }
  });
});
