import http from "node:http";
import type * as net from "node:net";
import { nodeRequestListener } from "../../../../apps/web/src/server/node-listener";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { app } from "../../../../apps/web/src/server/app-root";
import { publishBotChatEvent } from "../../../../apps/web/src/server/api/bots/bots.events";
import { endAllSse } from "../../../../apps/web/src/server/api/bots/bots.sse";
import { installFakeRuntime, resetAppTables, seedBot } from "../../fixtures";
import { createTestApp, signIn, type TestApp } from "../../helpers";

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

interface Served {
  server: http.Server;
  port: number;
  sockets: Set<net.Socket>;
}

async function listen(a: TestApp): Promise<Served> {
  const sockets = new Set<net.Socket>();
  const server = http.createServer(nodeRequestListener(a.fetch));
  server.on("connection", (socket) => sockets.add(socket));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as { port: number }).port, sockets };
}

function openStream(port: number, path: string, token: string): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path, headers: { authorization: `Bearer ${token}` } });
    req.on("response", resolve);
    req.on("error", reject);
  });
}

async function closeDown(served: Served, ...streams: http.IncomingMessage[]): Promise<void> {
  for (const stream of streams) stream.destroy();
  served.server.close();
  await new Promise((r) => setTimeout(r, 200));
}

describe("sse backpressure", () => {
  beforeEach(async () => {
    await resetAppTables();
    installFakeRuntime();
  });

  afterEach(() => {
    endAllSse();
  });

  it("ends a stream whose consumer stopped reading, instead of buffering without bound", async () => {
    const a = createTestApp();
    const { token } = await signIn(a);
    const bot = await seedBot({ conversationId: "9101" });
    const res = await a.request(`/api/v1/bots/${bot.id}/stream`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(app().openSseStreams.size).toBe(1);

    try {
      globalThis.gc?.();
      const before = process.memoryUsage().arrayBuffers;
      for (let i = 1; i <= 5_000; i++) publishBotChatEvent(bot.id, bigRun(i, 10_000));
      globalThis.gc?.();
      const growth = process.memoryUsage().arrayBuffers - before;

      expect(app().openSseStreams.size).toBe(0);
      expect(growth).toBeLessThan(8 * 1024 * 1024);
    } finally {
      await res.body?.cancel();
    }
  });

  it("keeps delivering to a client that keeps reading", async () => {
    const a = createTestApp();
    const { token } = await signIn(a);
    const bot = await seedBot({ conversationId: "9102" });
    const served = await listen(a);
    const reader = await openStream(served.port, `/api/v1/bots/${bot.id}/stream`, token);
    try {
      const frames: string[] = [];
      reader.on("data", (chunk) => frames.push(String(chunk)));
      await new Promise((r) => setTimeout(r, 200));
      for (let i = 1; i <= 100; i++) publishBotChatEvent(bot.id, bigRun(i, 10_000));
      await new Promise((r) => setTimeout(r, 500));

      expect(app().openSseStreams.size).toBe(1);
      expect(frames.join("")).toContain("run-100");
    } finally {
      await closeDown(served, reader);
    }
    expect(app().openSseStreams.size).toBe(0);
  });
});
