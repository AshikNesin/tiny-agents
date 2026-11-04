/**
 * Terminal WebSocket bridge (issue #28): ticket guards and the byte/control
 * relay, against a real HTTP server with a fake TerminalService injected
 * through the instance seam. The pty side is an in-memory Duplex, so no SSH
 * is involved; the close-code contract (1000 permanent / 4000 idle / 1011
 * attach failure) is asserted end to end.
 */
import { open } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  attachTerminalWs,
  issueTerminalTicket,
  redeemTerminalTicket,
  resetTerminalTicketsForTests,
} from "../../../apps/web/src/server/api/terminal/terminal.ws";
import { setTerminalServiceForTests } from "../../../apps/web/src/server/api/terminal/terminal.instance";
import type { PtyStream, TerminalService } from "../../../packages/agent/src/terminal/terminal";

/** An in-memory pty: records writes, echoes on demand, resizable. */
function fakePtyStream() {
  const received: Buffer[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  let destroyed = false;
  const stream = new Duplex({
    // As the ssh2 binding's ChannelDuplex: a remote end closes the stream.
    allowHalfOpen: false,
    read() {},
    write(chunk, _encoding, callback) {
      received.push(Buffer.from(chunk));
      callback();
    },
    destroy(error, callback) {
      destroyed = true;
      callback(error);
    },
  }) as PtyStream;
  stream.setWindow = (rows, cols) => resizes.push({ cols, rows });
  stream.done = Promise.resolve({ exitCode: null });
  return {
    stream,
    resizes,
    received: () => Buffer.concat(received).toString(),
    get destroyed() {
      return destroyed;
    },
  };
}

function serviceRecording(streams: () => PtyStream | Promise<PtyStream>) {
  const attached: Array<{ cols: number; rows: number }> = [];
  const svc: TerminalService = {
    status: async () => ({ kind: "ready" }),
    list: async () => ({ status: { kind: "ready" }, sessions: [] }),
    create: async () => {
      throw new Error("unused");
    },
    kill: async () => {},
    has: async () => true,
    attach: async (_name, init) => {
      attached.push({ cols: init.cols, rows: init.rows });
      return streams();
    },
  };
  return { svc, attached };
}

/** A real macrotask turn fake timers cannot intercept, so queued socket I/O runs. */
const realTick = () => new Promise<void>((resolve) => open("/dev/null", "r", () => resolve()));

describe("terminal WS bridge", () => {
  let server: Server;
  let port: number;
  let bridge: { close(): void };
  const sockets: WebSocket[] = [];

  const listen = async () => {
    server = createServer();
    bridge = attachTerminalWs(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  };

  beforeEach(() => {
    resetTerminalTicketsForTests();
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    bridge?.close();
    await new Promise((resolve) => server?.close(resolve));
    setTerminalServiceForTests(undefined);
    vi.restoreAllMocks();
  });

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

  const connect = (path: string) => {
    const ws = new WebSocket(`ws://localhost:${port}${path}`);
    ws.binaryType = "arraybuffer";
    sockets.push(ws);
    return ws;
  };
  const ticketPath = (ticket: string, name = "ta-term-1", extra = "") =>
    `/api/v1/terminal/ws/${name}?ticket=${encodeURIComponent(ticket)}${extra}`;

  const opened = (ws: WebSocket) =>
    new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("socket error")), { once: true });
    });

  const nextMessage = (ws: WebSocket) =>
    new Promise<string>((resolve, reject) => {
      ws.addEventListener(
        "message",
        (e) => resolve(Buffer.from(e.data as ArrayBuffer).toString()),
        { once: true },
      );
      ws.addEventListener("error", () => reject(new Error("socket error")), { once: true });
    });

  const closed = (ws: WebSocket) =>
    new Promise<{ code: number; reason: string }>((resolve) =>
      ws.addEventListener(
        "close",
        (e) => resolve({ code: (e as CloseEvent).code, reason: (e as CloseEvent).reason }),
        { once: true },
      ),
    );

  it("relays binary bytes both ways, untouched", async () => {
    const pty = fakePtyStream();
    const { svc, attached } = serviceRecording(async () => pty.stream);
    setTerminalServiceForTests(svc);
    await listen();

    const ws = connect(ticketPath(issueTerminalTicket({ userId: 1, name: "ta-term-1" as never })));
    await opened(ws);
    expect(attached).toEqual([{ cols: 120, rows: 34 }]); // defaults ride the query

    const reply = nextMessage(ws);
    pty.stream.push(Buffer.from("prompt$ "));
    expect(await reply).toBe("prompt$ ");

    ws.send(Buffer.from("ls\r"));
    await vi.waitFor(() => expect(pty.received()).toBe("ls\r"));
  });

  it("passes ?cols and ?rows through to the attach", async () => {
    const pty = fakePtyStream();
    const { svc, attached } = serviceRecording(async () => pty.stream);
    setTerminalServiceForTests(svc);
    await listen();
    const ws = connect(
      ticketPath(
        issueTerminalTicket({ userId: 1, name: "ta-term-1" as never }),
        "ta-term-1",
        "&cols=200&rows=50",
      ),
    );
    await opened(ws);
    expect(attached).toEqual([{ cols: 200, rows: 50 }]);
  });

  it("applies resize control frames and ignores malformed/unknown text", async () => {
    const pty = fakePtyStream();
    const { svc } = serviceRecording(async () => pty.stream);
    setTerminalServiceForTests(svc);
    await listen();
    const ws = connect(ticketPath(issueTerminalTicket({ userId: 1, name: "ta-term-1" as never })));
    await opened(ws);

    ws.send(JSON.stringify({ t: "resize", cols: 100, rows: 40 }));
    await vi.waitFor(() => expect(pty.resizes).toEqual([{ cols: 100, rows: 40 }]));

    ws.send("not json at all");
    ws.send(JSON.stringify({ t: "resize", cols: "wide", rows: "tall" }));
    ws.send(JSON.stringify({ t: "unknown", cols: 1, rows: 1 }));
    ws.send(JSON.stringify({ t: "resize", cols: 9999, rows: 9999 })); // clamped
    await new Promise((r) => setTimeout(r, 100));
    expect(pty.resizes).toEqual([
      { cols: 100, rows: 40 },
      { cols: 500, rows: 300 },
    ]);
    expect(ws.readyState).toBe(ws.OPEN); // still open: ignored, not fatal
  });

  it("stops reading the pty on {t:pause} and resumes on {t:resume}", async () => {
    const pty = fakePtyStream();
    const { svc } = serviceRecording(async () => pty.stream);
    setTerminalServiceForTests(svc);
    await listen();
    const ws = connect(ticketPath(issueTerminalTicket({ userId: 1, name: "ta-term-1" as never })));
    await opened(ws);
    await vi.waitFor(() => expect(pty.stream.isPaused()).toBe(false));

    ws.send(JSON.stringify({ t: "pause" }));
    await vi.waitFor(() => expect(pty.stream.isPaused()).toBe(true));
    ws.send(JSON.stringify({ t: "resume" }));
    await vi.waitFor(() => expect(pty.stream.isPaused()).toBe(false));

    // Bytes still flow after the round trip.
    const reply = nextMessage(ws);
    pty.stream.push(Buffer.from("after"));
    expect(await reply).toBe("after");
  });

  it("answers {t:ping} with a {t:pong} text frame", async () => {
    const pty = fakePtyStream();
    const { svc } = serviceRecording(async () => pty.stream);
    setTerminalServiceForTests(svc);
    await listen();
    const ws = connect(ticketPath(issueTerminalTicket({ userId: 1, name: "ta-term-1" as never })));
    await opened(ws);

    const reply = nextMessage(ws);
    ws.send(JSON.stringify({ t: "ping" }));
    expect(await reply).toBe('{"t":"pong"}');
    expect(pty.received()).toBe(""); // control, never typed into the shell
  });

  it("closes 1000 when the pty ends (session killed or client detached)", async () => {
    const pty = fakePtyStream();
    const { svc } = serviceRecording(async () => pty.stream);
    setTerminalServiceForTests(svc);
    await listen();
    const ws = connect(ticketPath(issueTerminalTicket({ userId: 1, name: "ta-term-1" as never })));
    await opened(ws);
    const gone = closed(ws);
    pty.stream.destroy(); // remote end gone
    expect((await gone).code).toBe(1000);
    await vi.waitFor(() => expect(pty.destroyed).toBe(true));
  });

  it("closes 1000 after tmux's error when the session does not exist", async () => {
    // The ticket route no longer checks has-session (issue #84): a missing
    // tab is found by the attach itself, which prints why and exits.
    const pty = fakePtyStream();
    const { svc } = serviceRecording(async () => {
      setImmediate(() => {
        pty.stream.push(Buffer.from("can't find session: ta-term-9\r\n"));
        pty.stream.push(null);
      });
      return pty.stream;
    });
    setTerminalServiceForTests(svc);
    await listen();
    const ws = connect(
      ticketPath(issueTerminalTicket({ userId: 1, name: "ta-term-9" as never }), "ta-term-9"),
    );
    const message = nextMessage(ws);
    const gone = closed(ws);
    await opened(ws);
    expect(await message).toContain("can't find session: ta-term-9");
    expect((await gone).code).toBe(1000);
  });

  it("closes 1011 when the attach fails after the ticket was spent", async () => {
    const { svc } = serviceRecording(async () => {
      throw new Error("ssh down");
    });
    setTerminalServiceForTests(svc);
    await listen();
    const ticket = issueTerminalTicket({ userId: 1, name: "ta-term-1" as never });
    const ws = connect(ticketPath(ticket));
    await opened(ws);
    expect((await closed(ws)).code).toBe(1011);
    expect(redeemTerminalTicket(ticket, "ta-term-1" as never)).toBeUndefined();
  });

  it("closes 4000 after ten idle minutes; traffic keeps it alive", async () => {
    const pty = fakePtyStream();
    const { svc } = serviceRecording(async () => pty.stream);
    setTerminalServiceForTests(svc);
    await listen();
    const ws = connect(ticketPath(issueTerminalTicket({ userId: 1, name: "ta-term-1" as never })));
    await opened(ws);

    // Fake time for the idle window, advanced in steps with a real I/O tick
    // between them: the bridge's ping/pong rides the real socket, and a
    // step without a tick would read as a dead client and terminate.
    vi.useFakeTimers();
    const step = async (ms: number) => {
      for (let t = 0; t < ms; t += 5_000) {
        await vi.advanceTimersByTimeAsync(Math.min(5_000, ms - t));
        await realTick();
      }
    };
    try {
      const gone = closed(ws);
      await step(9.5 * 60_000);
      expect(ws.readyState).toBe(ws.OPEN); // 9.5 quiet minutes: not yet
      ws.send(Buffer.from("x"));
      await step(9.5 * 60_000);
      expect(ws.readyState).toBe(ws.OPEN); // the keystroke reset the window
      await step(10.5 * 60_000);
      vi.useRealTimers();
      expect((await gone).code).toBe(4000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a missing, reused or wrong-name ticket with 401", async () => {
    const pty = fakePtyStream();
    const { svc } = serviceRecording(async () => pty.stream);
    setTerminalServiceForTests(svc);
    await listen();

    expect((await rawUpgrade(port, "/api/v1/terminal/ws/ta-term-1")).status).toBe(401);
    expect((await rawUpgrade(port, ticketPath("made-up"))).status).toBe(401);

    const ticket = issueTerminalTicket({ userId: 1, name: "ta-term-1" as never });
    expect((await rawUpgrade(port, ticketPath(ticket, "ta-term-2"))).status).toBe(401);
    // The wrong-name attempt already spent it.
    expect((await rawUpgrade(port, ticketPath(ticket))).status).toBe(401);
  });

  it("refuses a foreign Origin with 403 and keeps the ticket unspent", async () => {
    const pty = fakePtyStream();
    const { svc } = serviceRecording(async () => pty.stream);
    setTerminalServiceForTests(svc);
    await listen();
    const ticket = issueTerminalTicket({ userId: 1, name: "ta-term-1" as never });
    const evil = await rawUpgrade(port, ticketPath(ticket), { Origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    const own = await rawUpgrade(port, ticketPath(ticket), {
      Origin: `http://localhost:${port}`,
    });
    expect(own.status).toBe(101);
  });

  it("rejects a foreign session name with 400", async () => {
    const { svc } = serviceRecording(async () => fakePtyStream().stream);
    setTerminalServiceForTests(svc);
    await listen();
    expect((await rawUpgrade(port, "/api/v1/terminal/ws/not-ours?ticket=x")).status).toBe(400);
  });

  it("leaves other upgrade paths to their own listeners", async () => {
    const seen: { url?: string; destroyed: boolean }[] = [];
    server = createServer();
    bridge = attachTerminalWs(server);
    server.on("upgrade", (req, socket) => {
      seen.push({ url: req.url, destroyed: socket.destroyed });
      socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
    expect((await rawUpgrade(port, "/hmr")).status).toBe(400);
    expect(seen).toEqual([{ url: "/hmr", destroyed: false }]);
  });

  it("destroys the pty when the client goes away", async () => {
    const pty = fakePtyStream();
    const { svc } = serviceRecording(async () => pty.stream);
    setTerminalServiceForTests(svc);
    await listen();
    const ws = connect(ticketPath(issueTerminalTicket({ userId: 1, name: "ta-term-1" as never })));
    await opened(ws);
    ws.close();
    await vi.waitFor(() => expect(pty.destroyed).toBe(true));
  });
});
