export type SocketState = "connecting" | "live" | "reconnecting" | "closed";

export interface TransportEvents {
  live(): void;
  dropped(): void;
  ended(): void;
}

export interface SocketTransport<Ticket, Handle> {
  ticket(): Promise<Ticket>;
  open(ticket: Ticket, events: TransportEvents): Promise<Handle> | Handle;
  close(handle: Handle): void;
  gone?(error: unknown): boolean;
}

export interface ReconnectingSocket<Handle> {
  current(): Handle | undefined;
  close(): void;
}

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
