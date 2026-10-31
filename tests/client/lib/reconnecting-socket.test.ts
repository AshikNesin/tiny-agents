/**
 * The reconnecting socket the terminal and the browser viewer share: a fresh
 * ticket per attempt, the backoff schedule, a clean end that stops it, a
 * gone ticket that stops it at once, and a close that cancels everything,
 * including an attempt that was still opening.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  reconnectingSocket,
  type SocketState,
  type TransportEvents,
} from "@/lib/reconnecting-socket";

interface FakeHandle {
  id: number;
  events: TransportEvents;
  closed: boolean;
}

function fakeTransport() {
  const handles: FakeHandle[] = [];
  let tickets = 0;
  const transport = {
    ticket: vi.fn(async () => ({ n: ++tickets })),
    open: vi.fn(async (_ticket: { n: number }, events: TransportEvents) => {
      const handle: FakeHandle = { id: handles.length, events, closed: false };
      handles.push(handle);
      return handle;
    }),
    close: vi.fn((handle: FakeHandle) => {
      handle.closed = true;
    }),
    gone: (error: unknown) => error instanceof Error && error.message === "gone",
  };
  return { transport, handles };
}

const states: SocketState[] = [];
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  states.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("reconnectingSocket", () => {
  it("fetches a fresh ticket per attempt and backs off 1s, 3s, 5s, resetting after live", async () => {
    const { transport, handles } = fakeTransport();
    reconnectingSocket(transport, (state) => states.push(state));
    await settle();
    expect(transport.ticket).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["connecting"]);

    handles[0]!.events.dropped();
    await vi.advanceTimersByTimeAsync(999);
    expect(transport.ticket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.ticket).toHaveBeenCalledTimes(2);

    handles[1]!.events.dropped();
    await vi.advanceTimersByTimeAsync(2999);
    expect(transport.ticket).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.ticket).toHaveBeenCalledTimes(3);

    handles[2]!.events.live();
    expect(states.at(-1)).toBe("live");
    handles[2]!.events.dropped();
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.ticket).toHaveBeenCalledTimes(4); // back on the 1s step
  });

  it("stops for good when the server ends the connection", async () => {
    const { transport, handles } = fakeTransport();
    reconnectingSocket(transport, (state) => states.push(state));
    await settle();
    handles[0]!.events.live();
    handles[0]!.events.ended();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.ticket).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["connecting", "live", "closed"]);
  });

  it("stops at once when the ticket says the resource is gone, retries other ticket failures", async () => {
    const gone = fakeTransport();
    gone.transport.ticket.mockRejectedValueOnce(new Error("gone"));
    reconnectingSocket(gone.transport, (state) => states.push(state));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(gone.transport.ticket).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["connecting", "closed"]);

    states.length = 0;
    const flaky = fakeTransport();
    flaky.transport.ticket.mockRejectedValueOnce(new Error("network"));
    reconnectingSocket(flaky.transport, (state) => states.push(state));
    await vi.advanceTimersByTimeAsync(1000);
    expect(flaky.transport.ticket).toHaveBeenCalledTimes(2);
    expect(states).toEqual(["connecting", "reconnecting", "reconnecting"]);
  });

  it("retries when opening the transport throws", async () => {
    const { transport } = fakeTransport();
    transport.open.mockRejectedValueOnce(new Error("no socket"));
    reconnectingSocket(transport, (state) => states.push(state));
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.open).toHaveBeenCalledTimes(2);
  });

  it("close tears down the handle, cancels retries, and discards an attempt still opening", async () => {
    const { transport, handles } = fakeTransport();
    const socket = reconnectingSocket(transport, (state) => states.push(state));
    await settle();
    handles[0]!.events.live();
    expect(socket.current()).toBe(handles[0]);
    socket.close();
    expect(handles[0]!.closed).toBe(true);
    expect(socket.current()).toBeUndefined();
    expect(states.at(-1)).toBe("closed");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.ticket).toHaveBeenCalledTimes(1);

    // An attempt whose ticket was in flight when the socket closed opens nothing.
    const late = fakeTransport();
    let answer!: (ticket: { n: number }) => void;
    late.transport.ticket.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const second = reconnectingSocket(late.transport, () => undefined);
    second.close();
    answer({ n: 1 });
    await settle();
    expect(late.transport.open).not.toHaveBeenCalled();

    // One that was mid-open is closed as soon as it resolves.
    const opening = fakeTransport();
    let finishOpen!: (handle: FakeHandle) => void;
    opening.transport.open.mockReturnValueOnce(new Promise((resolve) => (finishOpen = resolve)));
    const third = reconnectingSocket(opening.transport, () => undefined);
    await settle();
    third.close();
    const handle: FakeHandle = { id: 99, events: {} as TransportEvents, closed: false };
    finishOpen(handle);
    await settle();
    expect(opening.transport.close).toHaveBeenCalledWith(handle);
  });

  it("ignores a stale handle's events after a newer attempt took over", async () => {
    const { transport, handles } = fakeTransport();
    const socket = reconnectingSocket(transport, (state) => states.push(state));
    await settle();
    handles[0]!.events.dropped();
    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.current()).toBe(handles[1]);
    // The old transport reports in late: no state change, no extra retry.
    handles[0]!.events.live();
    handles[0]!.events.dropped();
    expect(states.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.ticket).toHaveBeenCalledTimes(2);
  });
});
