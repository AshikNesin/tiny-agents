import http from "node:http";
import { PassThrough } from "node:stream";
import type { Duplex } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { WebSocket } from "ws";
import type { PtyStream } from "@tiny-agents/sandbox/terminal";
import { setTerminalServiceForTests } from "../../../../apps/web/src/server/api/terminal/terminal.instance";
import {
  issueTerminalTicket,
  resetTerminalTicketsForTests,
  attachTerminalWs,
} from "../../../../apps/web/src/server/api/terminal/terminal.ws";
import { resetAppTables } from "../../fixtures";
import { createTestApp, signIn } from "../../helpers";

const BRIDGE_CAP_BYTES = 4 * 1024 * 1024;

function fakePty(): PtyStream {
  const stream = new PassThrough() as PassThrough & { setWindow(): void };
  stream.setWindow = () => {};
  return stream as unknown as PtyStream;
}

describe("terminal bridge backpressure", () => {
  let server: http.Server;
  let closeBridge: { close(): void };
  let port: number;
  let pty: PtyStream;
  let owner: number;
  let serverSocket: Duplex;

  beforeAll(async () => {
    await resetAppTables();
    owner = (await signIn(createTestApp())).user.id;
    pty = fakePty();
    setTerminalServiceForTests({
      attach: async () => pty,
    } as never);
    resetTerminalTicketsForTests();
    server = http.createServer();
    server.on("upgrade", (_req, socket) => {
      serverSocket = socket;
    });
    closeBridge = attachTerminalWs(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => {
    setTerminalServiceForTests(undefined);
    closeBridge.close();
    server.close();
  });

  it("stops reading the pty when the client stops draining, and memory stays bounded", async () => {
    const ticket = issueTerminalTicket({ userId: owner, name: "ta-term-1" } as never);
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/v1/terminal/ws/ta-term-1?ticket=${ticket}`,
      {
        headers: { origin: `http://127.0.0.1:${port}` },
      },
    );
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    let frames = 0;
    ws.on("message", () => {
      frames += 1;
    });

    try {
      serverSocket.cork();
      const chunk = Buffer.alloc(64 * 1024, 7);
      for (let i = 0; i < 300; i++) pty.write(chunk);
      await new Promise((r) => setTimeout(r, 500));

      expect((pty as unknown as PassThrough).isPaused()).toBe(true);
      expect((pty as unknown as PassThrough).readableLength).toBeLessThan(
        BRIDGE_CAP_BYTES + 2 * 1024 * 1024,
      );
      expect(serverSocket.writableLength).toBeLessThan(BRIDGE_CAP_BYTES + 2 * 1024 * 1024);

      serverSocket.uncork();
      await new Promise((r) => setTimeout(r, 500));
      expect(frames).toBeGreaterThan(0);
    } finally {
      ws.close();
    }
  });
});
