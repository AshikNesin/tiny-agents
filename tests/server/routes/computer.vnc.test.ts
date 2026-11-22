import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  attachComputerVnc,
  issueComputerVncTicket,
  issueDesktopVncTicket,
  resetComputerVncTicketsForTests,
} from "../../../apps/web/src/server/api/bots/computer.vnc";
import { setComputerSessionsForTests } from "../../../apps/web/src/server/api/bots/computer.sessions";
import {
  createComputerSessions,
  type ComputerSessions,
} from "../../../packages/agent/src/toolkits/computer";
import { fakeComputer } from "../app/agent/computer-fakes";
import { authToken } from "../fixtures";

await authToken("ticket-owner-1@example.com", 1);

function fakeVm() {
  const received: Buffer[] = [];
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      received.push(Buffer.from(chunk));
      callback();
    },
  });
  return { stream, received: () => Buffer.concat(received).toString() };
}

function rawUpgrade(port: number, path: string) {
  return new Promise<number>((resolve, reject) => {
    const req = request({
      port,
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode!);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("computer VNC bridges", () => {
  let server: Server;
  let port: number;
  let bridge: { close(): void };
  let sessions: ComputerSessions;
  let vm: ReturnType<typeof fakeVm>;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    resetComputerVncTicketsForTests();
    vm = fakeVm();
    const fake = fakeComputer();
    const open = fake.transport.open.bind(fake.transport);
    fake.transport.open = async (profile, options) => ({
      ...(await open(profile, options)),
      vnc: { openStream: async () => vm.stream },
    });
    sessions = createComputerSessions({ transport: fake.transport });
    setComputerSessionsForTests(sessions);
    server = createServer();
    bridge = attachComputerVnc(server, { isOriginAllowed: () => true });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    bridge.close();
    await new Promise((resolve) => server.close(resolve));
    await sessions.closeAll();
    setComputerSessionsForTests(undefined);
  });

  it("relays the Computer page's viewer to the desktop, both ways", async () => {
    await sessions.acquire("shared");
    const ticket = issueDesktopVncTicket({ userId: 1, profile: "shared" });
    const ws = new WebSocket(`ws://localhost:${port}/api/v1/computer/shared/vnc?ticket=${ticket}`);
    ws.binaryType = "arraybuffer";
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("socket error")), { once: true });
    });
    const message = new Promise<string>((resolve) =>
      ws.addEventListener(
        "message",
        (e) => resolve(Buffer.from(e.data as ArrayBuffer).toString()),
        { once: true },
      ),
    );
    vm.stream.push("RFB 003.008\n");
    expect(await message).toBe("RFB 003.008\n");
    ws.send("client-hello");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vm.received()).toBe("client-hello");
  });

  it("accepts a ticket only on the path and desktop it was minted for", async () => {
    await sessions.acquire("shared");
    const page = issueDesktopVncTicket({ userId: 1, profile: "shared" });
    expect(await rawUpgrade(port, `/api/v1/bots/shared/computer/vnc?ticket=${page}`)).toBe(401);

    const bot = issueComputerVncTicket({ userId: 1, botId: "b1", profile: "shared" });
    expect(await rawUpgrade(port, `/api/v1/computer/shared/vnc?ticket=${bot}`)).toBe(401);

    const other = issueDesktopVncTicket({ userId: 1, profile: "shared" });
    expect(await rawUpgrade(port, `/api/v1/computer/bot-x/vnc?ticket=${other}`)).toBe(401);
  });

  it("refuses a desktop that is not running", async () => {
    const ticket = issueDesktopVncTicket({ userId: 1, profile: "shared" });
    expect(await rawUpgrade(port, `/api/v1/computer/shared/vnc?ticket=${ticket}`)).toBe(404);
  });

  it("caps live tickets per user at ten in each store, and a redeemed one frees its slot", async () => {
    const first = issueDesktopVncTicket({ userId: 1, profile: "shared" });
    for (let i = 0; i < 9; i++) issueDesktopVncTicket({ userId: 1, profile: "shared" });
    expect(() => issueDesktopVncTicket({ userId: 1, profile: "shared" })).toThrow(/Too many/);
    expect(await rawUpgrade(port, `/api/v1/computer/shared/vnc?ticket=${first}`)).toBe(404);
    expect(() => issueDesktopVncTicket({ userId: 1, profile: "shared" })).not.toThrow();

    for (let i = 0; i < 10; i++)
      issueComputerVncTicket({ userId: 1, botId: "b1", profile: "shared" });
    expect(() => issueComputerVncTicket({ userId: 1, botId: "b1", profile: "shared" })).toThrow(
      /Too many/,
    );
  });
});
