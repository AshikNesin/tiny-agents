/**
 * A connection that keeps itself up: a fresh single-use ticket per attempt,
 * the transport opened for it, backoff between failures, and one `close()`
 * that stops the socket and any pending retry. The terminal (a WebSocket of
 * pty frames) and the browser viewer (a noVNC session) both run on it and
 * supply only their transport.
 */
export type SocketState = "connecting" | "live" | "reconnecting" | "closed";

/** What an open transport reports back. */
export interface TransportEvents {
  /** The connection is up. Resets the backoff. */
  live(): void;
  /** The connection fell over; a retry follows. */
  dropped(): void;
  /** The server ended it on purpose (the tab was killed): no retry. */
  ended(): void;
}

export interface SocketTransport<Ticket, Handle> {
  /** A fresh single-use ticket for this attempt. */
  ticket(): Promise<Ticket>;
  /** Open the transport for the ticket; a throw retries. Report through `events`. */
  open(ticket: Ticket, events: TransportEvents): Promise<Handle> | Handle;
  /** Close an open handle for good (teardown, or an attempt that lost the race). */
  close(handle: Handle): void;
  /** A ticket error no retry can fix (the resource is gone): give up at once. */
  gone?(error: unknown): boolean;
}

export interface ReconnectingSocket<Handle> {
  /** The open handle, while there is one. */
  current(): Handle | undefined;
  /** Stop the socket and any pending retry; state becomes "closed". */
  close(): void;
}

/** Same schedule for every socket; the cap holds forever. */
const BACKOFF_SECONDS = [1, 3, 5, 10, 20, 30];

export function reconnectingSocket<Ticket, Handle>(
  transport: SocketTransport<Ticket, Handle>,
  onState: (state: SocketState) => void,
  signal?: AbortSignal,
): ReconnectingSocket<Handle> {
  let handle: Handle | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let closed = false;
  /** The newest attempt; an older one's transport reporting in late is ignored. */
  let generation = 0;

  const teardown = (): void => {
    if (closed) return;
    closed = true;
    clearTimeout(retry);
    if (handle !== undefined) transport.close(handle);
    handle = undefined;
    onState("closed");
  };

  signal?.addEventListener("abort", teardown, { once: true });
  if (signal?.aborted) teardown();

  const scheduleRetry = (): void => {
    if (closed) return;
    onState("reconnecting");
    const seconds = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)] ?? 30;
    attempt += 1;
    retry = setTimeout(() => void connect(), seconds * 1000);
  };

  const connect = async (): Promise<void> => {
    if (closed) return;
    const mine = ++generation;
    const current = () => !closed && mine === generation;
    onState(attempt === 0 ? "connecting" : "reconnecting");

    let ticket: Ticket;
    try {
      ticket = await transport.ticket();
    } catch (error) {
      if (!current()) return;
      if (transport.gone?.(error)) {
        teardown();
        return;
      }
      scheduleRetry();
      return;
    }
    if (!current()) return;

    const events: TransportEvents = {
      live: () => {
        if (!current()) return;
        attempt = 0;
        onState("live");
      },
      dropped: () => {
        if (!current()) return;
        handle = undefined;
        scheduleRetry();
      },
      ended: () => {
        if (!current()) return;
        handle = undefined;
        teardown();
      },
    };
    let own: Handle;
    try {
      own = await transport.open(ticket, events);
    } catch {
      if (current()) scheduleRetry();
      return;
    }
    if (!current()) {
      transport.close(own);
      return;
    }
    handle = own;
  };

  void connect();

  return {
    current: () => handle,
    close: teardown,
  };
}
