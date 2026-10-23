/**
 * VNC bridge (issue #24): one-time tickets and the WebSocket that pipes a
 * viewer to the VM's RFB stream. The VM side is a fake duplex handed out by
 * the live session's `vnc.openStream`, so no SSH or Chrome is involved.
 */
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  attachBrowserVnc,
  issueVncTicket,
  redeemVncTicket,
  resetVncTicketsForTests,
} from "../../../apps/web/src/server/api/bots/browser.vnc";
import {
  acquire,
  resetBrowserSessionsForTests,
  type BrowserSession,
} from "../../../packages/agent/src/toolkits/browser";

const BOT = "bot-vnc";
const TARGET = { profile: "shared", tab: BOT };

function fakeVm() {
  const received: Buffer[] = [];
  let destroyed = false;
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      received.push(Buffer.from(chunk));
      callback();
    },
    destroy(error, callback) {
      destroyed = true;
      callback(error);
    },
  });
  return {
    stream,
    received: () => Buffer.concat(received).toString(),
    get destroyed() {
      return destroyed;
    },
  };
}

function session(openStream?: () => Promise<Duplex>): BrowserSession {
  return {
    vnc: openStream ? { scale: 2, openStream, resize: async () => {} } : undefined,
    url: () => "about:blank",
    navigate: async () => ({ url: "about:blank", status: 200 }),
    snapshot: async () => "",
    click: async () => ({ url: "about:blank" }),
    type: async () => ({ url: "about:blank" }),
    press: async () => {},
    scroll: async () => {},
    screenshot: async () => ({ data: "" }),
    close: async () => {},
  };
}

async function openLive(openStream?: () => Promise<Duplex>) {
  resetBrowserSessionsForTests();
  await acquire(
    { transport: async () => session(openStream), profilesDir: "/tmp/ta-vnc-profiles" },
    TARGET,
  );
}

const ticketPath = (ticket: string, bot = BOT) =>
  `/api/v1/bots/${bot}/browser/vnc?ticket=${encodeURIComponent(ticket)}`;

const mint = (bot = BOT) => issueVncTicket({ userId: 1, botId: bot, target: TARGET });

/** A raw upgrade request: reports the HTTP status of a rejection, or 101. */
function rawUpgrade(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number }>((resolve, reject) => {
    const req = request({
      port,
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...headers,
      },
    });
    req.on("response", (res) => {
      res.resume();
      resolve({ status: res.statusCode! });
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode! });
    });
    req.on("error", reject);
    req.end();
  });
}

function connect(port: number, path: string) {
  const ws = new WebSocket(`ws://localhost:${port}${path}`);
  ws.binaryType = "arraybuffer";
  return ws;
}

const nextMessage = (ws: WebSocket) =>
  new Promise<string>((resolve, reject) => {
    ws.addEventListener("message", (e) => resolve(Buffer.from(e.data as ArrayBuffer).toString()), {
      once: true,
    });
    ws.addEventListener("error", () => reject(new Error("socket error")), { once: true });
  });

const opened = (ws: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("socket error")), { once: true });
  });

const closed = (ws: WebSocket) =>
  new Promise<void>((resolve) => ws.addEventListener("close", () => resolve(), { once: true }));

describe("VNC tickets", () => {
  beforeEach(() => resetVncTicketsForTests());
  afterEach(() => vi.restoreAllMocks());

  it("redeems once, for the bot it was issued to", () => {
    const ticket = mint();
    expect(redeemVncTicket(ticket, BOT)).toMatchObject({
      userId: 1,
      botId: BOT,
      target: TARGET,
    });
    expect(redeemVncTicket(ticket, BOT)).toBeUndefined();
  });

  it("is spent by a wrong-bot attempt", () => {
    const ticket = mint();
    expect(redeemVncTicket(ticket, "other-bot")).toBeUndefined();
    expect(redeemVncTicket(ticket, BOT)).toBeUndefined();
  });

  it("expires after a minute", () => {
    const ticket = mint();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    expect(redeemVncTicket(ticket, BOT)).toBeUndefined();
  });

  it("is unguessable and unique", () => {
    const tickets = new Set(Array.from({ length: 20 }, () => mint()));
    expect(tickets.size).toBe(20);
    for (const ticket of tickets) expect(ticket).toMatch(/^[A-Za-z0-9_-]{30,}$/);
  });

  it("rejects an unknown ticket", () => {
    expect(redeemVncTicket("nope", BOT)).toBeUndefined();
    expect(redeemVncTicket("", BOT)).toBeUndefined();
  });
});

describe("VNC WebSocket bridge", () => {
  let server: Server;
  let port: number;
  let bridge: { close(): void };
  const sockets: WebSocket[] = [];

  const listen = async (build: (server: Server) => void = () => {}) => {
    server = createServer();
    bridge = attachBrowserVnc(server);
    build(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  };

  beforeEach(() => {
    resetVncTicketsForTests();
    resetBrowserSessionsForTests();
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    bridge?.close();
    await new Promise((resolve) => server?.close(resolve));
    resetBrowserSessionsForTests();
  });

  it("relays bytes both ways and tears down with either side", async () => {
    const vm = fakeVm();
    vm.stream.push(Buffer.from("RFB 003.008\n"));
    await openLive(async () => vm.stream);
    await listen();

    const ws = connect(port, ticketPath(mint()));
    sockets.push(ws);
    expect(await nextMessage(ws)).toBe("RFB 003.008\n");

    ws.send(Buffer.from("RFB 003.008\n"));
    await vi.waitFor(() => expect(vm.received()).toBe("RFB 003.008\n"));

    const reply = nextMessage(ws);
    vm.stream.push(Buffer.from("more"));
    expect(await reply).toBe("more");

    ws.close();
    await vi.waitFor(() => expect(vm.destroyed).toBe(true));
  });

  it("closes the viewer when the VM stream ends", async () => {
    const vm = fakeVm();
    vm.stream.push(Buffer.from("hi"));
    await openLive(async () => vm.stream);
    await listen();

    const ws = connect(port, ticketPath(mint()));
    sockets.push(ws);
    await nextMessage(ws);
    const gone = closed(ws);
    vm.stream.destroy();
    await gone;
  });

  it("closes the viewer when the VM stream cannot be opened", async () => {
    await openLive(async () => {
      throw new Error("ssh down");
    });
    await listen();

    const ws = connect(port, ticketPath(mint()));
    sockets.push(ws);
    await opened(ws);
    await closed(ws);
  });

  it("refuses a missing, reused or wrong-bot ticket with 401", async () => {
    await openLive(async () => fakeVm().stream);
    await listen();

    expect((await rawUpgrade(port, `/api/v1/bots/${BOT}/browser/vnc`)).status).toBe(401);
    expect((await rawUpgrade(port, ticketPath("made-up"))).status).toBe(401);

    const ticket = mint();
    expect((await rawUpgrade(port, ticketPath(ticket, "other-bot"))).status).toBe(401);
    // The wrong-bot attempt already spent it.
    expect((await rawUpgrade(port, ticketPath(ticket))).status).toBe(401);
  });

  it("accepts a ticket once", async () => {
    await openLive(async () => fakeVm().stream);
    await listen();
    const ticket = mint();
    expect((await rawUpgrade(port, ticketPath(ticket))).status).toBe(101);
    expect((await rawUpgrade(port, ticketPath(ticket))).status).toBe(401);
  });

  it("refuses a foreign Origin with 403 and keeps the ticket unspent", async () => {
    await openLive(async () => fakeVm().stream);
    await listen();
    const ticket = mint();
    const evil = await rawUpgrade(port, ticketPath(ticket), { Origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    const own = await rawUpgrade(port, ticketPath(ticket), { Origin: `http://localhost:${port}` });
    expect(own.status).toBe(101);
  });

  it("returns 404 when the browser has no VNC display or is gone", async () => {
    await openLive();
    await listen();
    expect((await rawUpgrade(port, ticketPath(mint()))).status).toBe(404);
    resetBrowserSessionsForTests();
    expect((await rawUpgrade(port, ticketPath(mint()))).status).toBe(404);
  });

  it("caps viewers per bot at four", async () => {
    await openLive(async () => fakeVm().stream);
    await listen();
    for (let i = 0; i < 4; i++) {
      const ws = connect(port, ticketPath(mint()));
      sockets.push(ws);
      await opened(ws);
    }
    expect((await rawUpgrade(port, ticketPath(mint()))).status).toBe(429);

    sockets.shift()!.close();
    await vi.waitFor(async () => {
      expect((await rawUpgrade(port, ticketPath(mint()))).status).toBe(101);
    });
  });

  it("leaves other upgrade paths to their own listeners", async () => {
    const seen: { url?: string; destroyed: boolean }[] = [];
    await listen((s) => {
      s.on("upgrade", (req, socket) => {
        seen.push({ url: req.url, destroyed: socket.destroyed });
        socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
      });
    });
    expect((await rawUpgrade(port, "/hmr")).status).toBe(400);
    expect(seen).toEqual([{ url: "/hmr", destroyed: false }]);
  });

  it("drops an upgrade nobody else will answer", async () => {
    await listen();
    await expect(rawUpgrade(port, "/hmr")).rejects.toThrow();
  });
});
