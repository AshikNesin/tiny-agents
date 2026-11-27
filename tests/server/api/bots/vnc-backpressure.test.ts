import http from "node:http";
import type { Duplex } from "node:stream";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { resetAppTables } from "../../fixtures";
import { WebSocket } from "ws";
import {
  attachVncBridge,
  type VncTarget,
} from "../../../../apps/web/src/server/api/bots/desktop.vnc";
import { createTicketStore } from "../../../../apps/web/src/server/api/ws/upgrade";
import { createTestApp, signIn } from "../../helpers";

const PATH = /^\/probe\/vnc\/([^/]+)$/;
const BRIDGE_CAP_BYTES = 4 * 1024 * 1024;

interface Ticket {
  userId: number;
  botId: string;
}

const tickets = createTicketStore<Ticket>({ perUserLimit: 5 });
const targets = new Map<string, VncTarget>();

function makeTarget(): { target: VncTarget; stream: PassThrough } {
  const stream = new PassThrough();
  return {
    target: { openStream: async () => stream, touch: () => {}, ownerInput: () => {} },
    stream,
  };
}

describe("vnc bridge backpressure", () => {
  let server: http.Server;
  let closeBridge: { close(): void };
  let port: number;
  let serverSocket: Duplex;
  let owner: number;

  beforeAll(async () => {
    await resetAppTables();
    const { user } = await signIn(createTestApp());
    owner = user.id;
    server = http.createServer();
    server.on("upgrade", (_req, socket) => {
      serverSocket = socket;
    });
    closeBridge = attachVncBridge(server, {
      path: PATH,
      scope: (ticket) => ticket.botId,
      tickets,
      resolve: (ticket) => targets.get(ticket.botId),
      kind: "probe",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => {
    closeBridge.close();
    server.close();
  });

  it("stops reading the upstream when the client stops draining, and memory stays bounded", async () => {
    const { target, stream } = makeTarget();
    targets.set("bot1", target);
    const ticket = tickets.issue({ userId: owner, botId: "bot1" });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/probe/vnc/bot1?ticket=${ticket}`, {
      headers: { origin: `http://127.0.0.1:${port}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    let received = 0;
    ws.on("message", () => {
      received += 1;
    });

    try {
      serverSocket.cork();
      const chunk = Buffer.alloc(64 * 1024, 7);
      for (let i = 0; i < 300; i++) stream.write(chunk);
      await new Promise((r) => setTimeout(r, 500));

      const writable = serverSocket.writableLength;
      expect(stream.isPaused()).toBe(true);
      expect(writable).toBeLessThan(BRIDGE_CAP_BYTES + 2 * 1024 * 1024);
      expect(stream.readableLength).toBeLessThan(BRIDGE_CAP_BYTES + 2 * 1024 * 1024);

      serverSocket.uncork();
      await new Promise((r) => setTimeout(r, 500));
      expect(received).toBeGreaterThan(0);
    } finally {
      ws.close();
      stream.destroy();
    }
  });
});
