/**
 * Characterization of behavior-register row C18: terminal idle close never
 * happens while output is chatty, and backpressure stacks `drain` listeners.
 * Preserve: this pins today's behavior, quirk included; change it only with
 * a signed-off register row.
 */
import { open } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  attachTerminalWs,
  issueTerminalTicket,
  resetTerminalTicketsForTests,
} from "../../../apps/web/src/server/api/terminal/terminal.ws";
import { setTerminalServiceForTests } from "../../../apps/web/src/server/api/terminal/terminal.instance";
import type { PtyStream, TerminalService } from "../../../packages/agent/src/terminal/terminal";
import { authToken } from "../fixtures";

// Tickets are held as live access, which needs their accounts to exist.
await authToken("c18-owner@example.com", 1);

/**
 * An in-memory pty. `stuck`: the remote end never takes a write, so after
 * the first byte every `write()` returns false until `release()`.
 */
function fakePty(options: { stuck?: boolean } = {}) {
  const writes: Buffer[] = [];
  const held: Array<() => void> = [];
  const stream = new Duplex({
    allowHalfOpen: false,
    writableHighWaterMark: 1,
    read() {},
    write(chunk, _encoding, callback) {
      writes.push(Buffer.from(chunk));
      if (options.stuck) held.push(callback);
      else callback();
    },
  }) as PtyStream;
  stream.setWindow = () => undefined;
  stream.done = Promise.resolve({ exitCode: null });
  return {
    stream,
    writes,
    /** The remote end takes everything from now on. */
    release: () => {
      options.stuck = false;
      held.splice(0).forEach((callback) => callback());
    },
  };
}

function serviceFor(stream: PtyStream): TerminalService {
  return {
    status: async () => ({ kind: "ready" }),
    list: async () => ({ status: { kind: "ready" }, sessions: [] }),
    create: async () => {
      throw new Error("unused");
    },
    kill: async () => {},
    has: async () => true,
    attach: async () => stream,
  };
}

/** A real macrotask turn fake timers cannot intercept, so queued socket I/O runs. */
const realTick = () => new Promise<void>((resolve) => open("/dev/null", "r", () => resolve()));

let server: Server;
let bridge: { close(): void };
const sockets: WebSocket[] = [];

async function connect(stream: PtyStream): Promise<WebSocket> {
  setTerminalServiceForTests(serviceFor(stream));
  server = createServer();
  bridge = attachTerminalWs(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const ticket = issueTerminalTicket({ userId: 1, name: "ta-term-1" as never });
  const ws = new WebSocket(
    `ws://localhost:${port}/api/v1/terminal/ws/ta-term-1?ticket=${encodeURIComponent(ticket)}`,
  );
  ws.binaryType = "arraybuffer";
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("socket error")), { once: true });
  });
  return ws;
}

beforeEach(() => resetTerminalTicketsForTests());
afterEach(async () => {
  vi.useRealTimers();
  for (const ws of sockets.splice(0)) ws.close();
  bridge?.close();
  await new Promise((resolve) => server?.close(resolve));
  setTerminalServiceForTests(undefined);
});

describe("C18: the terminal bridge", () => {
  it("never idle-closes while the pty keeps printing, though nobody types", async () => {
    const pty = fakePty();
    const ws = await connect(pty.stream);
    let closedWith: number | undefined;
    ws.addEventListener("close", (event) => void (closedWith = (event as CloseEvent).code));

    vi.useFakeTimers();
    // One line of output every five minutes for an hour; the client sends nothing.
    for (let minute = 0; minute < 60; minute += 5) {
      pty.stream.push(Buffer.from(`tick ${minute}\r\n`));
      for (let step = 0; step < 5; step++) {
        await vi.advanceTimersByTimeAsync(60_000);
        await realTick();
      }
    }
    expect(closedWith).toBeUndefined();
    expect(ws.readyState).toBe(ws.OPEN);
    expect(pty.writes).toEqual([]);

    // Contrast: the output stops, and ten quiet minutes later it closes 4000.
    for (let step = 0; step < 11; step++) {
      await vi.advanceTimersByTimeAsync(60_000);
      await realTick();
    }
    vi.useRealTimers();
    await vi.waitFor(() => expect(closedWith).toBe(4000));
  });

  it("adds one `drain` listener per keystroke frame the full pty refuses", async () => {
    const pty = fakePty({ stuck: true });
    const refusals: boolean[] = [];
    const write = pty.stream.write.bind(pty.stream) as (chunk: Buffer) => boolean;
    pty.stream.write = ((chunk: Buffer) => {
      const accepted = write(chunk);
      if (!accepted) refusals.push(accepted);
      return accepted;
    }) as PtyStream["write"];
    const ws = await connect(pty.stream);

    // A burst of keystrokes arrives together; the pty takes none of them.
    for (const key of ["a", "b", "c", "d", "e"]) ws.send(Buffer.from(key));
    await vi.waitFor(() => expect(refusals.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(refusals.length).toBeGreaterThan(1);
    expect(pty.stream.listenerCount("drain")).toBe(refusals.length);

    // One drain fires them all, and each resumes the socket.
    pty.release();
    await vi.waitFor(() => expect(pty.stream.listenerCount("drain")).toBe(0));
  });
});
