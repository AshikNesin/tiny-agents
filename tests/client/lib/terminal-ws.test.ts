/**
 * Attach-client behavior (issue #28): fresh single-use ticket per attempt,
 * pty bytes both ways, the resize control frame, the shared backoff
 * schedule, and a teardown that kills the socket and pending retries.
 * WebSocket is faked; no server is involved.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ApiError } from "@groot/shell/lib/api";

const ticketMock = vi.fn();

vi.mock("@/lib/terminal-api", () => ({
  terminalApi: {
    ticket: (...args: unknown[]) => ticketMock(...args),
  },
}));

import {
  connectTerminal,
  HIGH_WATERMARK,
  LOW_WATERMARK,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  type TerminalConnectionState,
} from "@/lib/terminal-ws";

interface FakeCloseEvent {
  code: number;
}

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = 0;
  binaryType = "blob";
  closeCalled = false;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: FakeCloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalled = true;
    this.readyState = 3;
  }

  // Test-side drivers.
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  deliver(bytes: Uint8Array): void {
    this.onmessage?.({ data: bytes.slice().buffer });
  }

  deliverText(text: string): void {
    this.onmessage?.({ data: text });
  }

  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const states: TerminalConnectionState[] = [];
const data: Uint8Array[] = [];
let ticketNumber = 0;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  ticketNumber = 0;
  states.length = 0;
  data.length = 0;
  ticketMock.mockImplementation(async () => {
    ticketNumber += 1;
    return { path: `/api/v1/terminal/ws/ta-term-1?ticket=t${ticketNumber}` };
  });
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function connect(signal?: AbortSignal) {
  return connectTerminal(
    "ta-term-1",
    {
      onData: (bytes) => data.push(bytes),
      onStateChange: (state) => states.push(state),
    },
    signal,
  );
}

/** Let the ticket promise and the socket constructor settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("connectTerminal", () => {
  it("fetches a fresh ticket and opens a websocket per attempt", async () => {
    connect();
    await settle();

    const first = FakeWebSocket.instances[0]!;
    expect(first.url).toBe(`ws://${window.location.host}/api/v1/terminal/ws/ta-term-1?ticket=t1`);

    first.drop();
    await vi.advanceTimersByTimeAsync(1000);

    expect(ticketMock).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances[1]!.url).toContain("ticket=t2");
  });

  it("delivers binary frames as bytes and sends input as binary", async () => {
    const connection = connect();
    await settle();
    const ws = FakeWebSocket.instances[0]!;

    ws.open();
    connection.sendInput(new Uint8Array([104, 105]));

    expect(ws.sent).toEqual([new Uint8Array([104, 105])]);

    ws.deliver(new Uint8Array([112, 116, 121]));
    expect(data).toEqual([new Uint8Array([112, 116, 121])]);
  });

  it("drops input and resize until the socket is open", async () => {
    const connection = connect();
    await settle();

    connection.sendInput(new Uint8Array([1]));
    connection.sendResize(80, 24);

    expect(FakeWebSocket.instances[0]!.sent).toEqual([]);
  });

  it("sends resize as a json control text frame", async () => {
    const connection = connect();
    await settle();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();

    connection.sendResize(120, 34);

    expect(ws.sent).toEqual(['{"t":"resize","cols":120,"rows":34}']);
  });

  it("backs off 1s, 3s, 5s between attempts and resets after success", async () => {
    connect();
    await settle();

    FakeWebSocket.instances[0]!.drop();
    await vi.advanceTimersByTimeAsync(999);
    expect(ticketMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticketMock).toHaveBeenCalledTimes(2);

    FakeWebSocket.instances[1]!.drop();
    await vi.advanceTimersByTimeAsync(2999);
    expect(ticketMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticketMock).toHaveBeenCalledTimes(3);

    FakeWebSocket.instances[2]!.open();
    FakeWebSocket.instances[2]!.drop();
    await vi.advanceTimersByTimeAsync(999);
    expect(ticketMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticketMock).toHaveBeenCalledTimes(4); // back on the 1s step
    expect(states).toContain("live");
  });

  it("stops reconnecting when the server closes cleanly", async () => {
    connect();
    await settle();

    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.drop(1000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(ticketMock).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("closed");
  });

  it("stops reconnecting when the tab is gone (404/409 on the ticket)", async () => {
    ticketMock.mockRejectedValueOnce(
      new ApiError({ status: 404, code: "NOT_FOUND", message: "gone", url: "/terminal" }),
    );
    connect();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(ticketMock).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["connecting", "closed"]);
  });

  it("retries when the ticket request fails transiently", async () => {
    ticketMock.mockRejectedValueOnce(new Error("network"));
    connect();
    await vi.advanceTimersByTimeAsync(1000);

    expect(ticketMock).toHaveBeenCalledTimes(2);
    expect(states).toEqual(["connecting", "reconnecting", "reconnecting"]);
  });

  it("abort tears down the socket and cancels retries", async () => {
    const controller = new AbortController();
    const connection = connect(controller.signal);
    await settle();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();

    controller.abort();
    connection.sendInput(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(ws.closeCalled).toBe(true);
    expect(ticketMock).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("closed");
  });

  it("attaches at the rendered grid: cols/rows ride on the url", async () => {
    connectTerminal("ta-term-1", {
      onData: () => undefined,
      onStateChange: () => undefined,
      size: () => ({ cols: 173, rows: 41 }),
    });
    await settle();
    const url = new URL(FakeWebSocket.instances[0]!.url);
    expect(url.searchParams.get("ticket")).toBe("t1");
    expect(url.searchParams.get("cols")).toBe("173");
    expect(url.searchParams.get("rows")).toBe("41");
  });

  it("pauses the server past the high watermark and resumes below the low one", async () => {
    const connection = connect();
    await settle();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();

    const chunk = new Uint8Array(128 * 1024);
    const chunks = Math.ceil(HIGH_WATERMARK / chunk.byteLength) + 1;
    for (let i = 0; i < chunks; i++) ws.deliver(chunk);
    expect(ws.sent).toEqual(['{"t":"pause"}']);

    // xterm catches up: not yet below the low mark, then below it.
    connection.written(chunks * chunk.byteLength - LOW_WATERMARK);
    expect(ws.sent).toEqual(['{"t":"pause"}']);
    connection.written(1);
    expect(ws.sent).toEqual(['{"t":"pause"}', '{"t":"resume"}']);
  });

  it("starts every new socket unpaused", async () => {
    const connection = connect();
    await settle();
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.deliver(new Uint8Array(HIGH_WATERMARK + 1));
    expect(first.sent).toEqual(['{"t":"pause"}']);

    first.drop();
    await vi.advanceTimersByTimeAsync(1000);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    // Late acknowledgements for the old socket's bytes send nothing stray.
    connection.written(HIGH_WATERMARK + 1);
    second.deliver(new Uint8Array(10));
    expect(second.sent).toEqual([]);
  });

  it("pings while visible and reconnects at once when no pong comes back", async () => {
    connect();
    await settle();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();

    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(ws.sent).toEqual(['{"t":"ping"}']);
    ws.deliverText('{"t":"pong"}');

    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(ws.sent).toEqual(['{"t":"ping"}', '{"t":"ping"}']);
    // Half-open: nothing comes back.
    await vi.advanceTimersByTimeAsync(PONG_TIMEOUT_MS);
    expect(ws.closeCalled).toBe(true);
    expect(states.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not ping a hidden page (the server's idle timer may reclaim it)", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    connect();
    await settle();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 3);
    expect(ws.sent).toEqual([]);

    // Coming back probes at once: a laptop that slept has a dead socket.
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ws.sent).toEqual(['{"t":"ping"}']);
    visibility.mockRestore();
  });

  it("treats any frame as proof of life", async () => {
    connect();
    await settle();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    ws.deliver(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(PONG_TIMEOUT_MS);
    expect(ws.closeCalled).toBe(false);
  });
});
