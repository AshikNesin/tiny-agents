/**
 * Framework-free attach client for one terminal tab (issue #28).
 * Ticket -> WebSocket -> binary pty frames, reconnect with backoff and a
 * fresh single-use ticket per attempt (the VncView pattern). xterm wiring
 * stays in the page; this module owns the socket lifecycle so it can be
 * unit-tested without React.
 */
import { isAxiosError } from "axios";
import { terminalApi } from "./terminal-api";

export type TerminalConnectionState = "connecting" | "live" | "reconnecting" | "closed";

/** Text frames the protocol defines; binary frames are pty bytes. */
export interface ResizeFrame {
  t: "resize";
  cols: number;
  rows: number;
}

export interface TerminalHandlers {
  onData: (bytes: Uint8Array) => void;
  onStateChange: (state: TerminalConnectionState) => void;
}

export interface TerminalConnection {
  /** Keystrokes as pty bytes. No-op until the socket is open. */
  sendInput(bytes: Uint8Array<ArrayBuffer>): void;
  /** Tell the server (and tmux) the grid changed. */
  sendResize(cols: number, rows: number): void;
  /** Stops the socket and any pending retry; state becomes "closed". */
  close(): void;
}

/** Same schedule as the browser viewer; the cap holds forever. */
const BACKOFF_SECONDS = [1, 3, 5, 10, 20, 30];
/** Close code the server uses to end the connection cleanly. */
const NORMAL_CLOSE = 1000;

function wsUrl(path: string): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${path}`;
}

/**
 * Attach to tab `name`. Reconnects until `signal` aborts or `close()` is
 * called; a ticket fetch that fails with 404/409 gives up immediately (the
 * tab was killed on the VM), otherwise every failure retries.
 */
export function connectTerminal(
  name: string,
  handlers: TerminalHandlers,
  signal?: AbortSignal,
): TerminalConnection {
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let closed = false;

  const emit = (state: TerminalConnectionState): void => handlers.onStateChange(state);

  const cleanupSocket = (): void => {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close();
    socket = undefined;
  };

  const teardown = (): void => {
    if (closed) return;
    closed = true;
    cleanupSocket();
    clearTimeout(retry);
    emit("closed");
  };

  signal?.addEventListener("abort", teardown, { once: true });
  if (signal?.aborted) {
    teardown();
  }

  const scheduleRetry = (): void => {
    emit("reconnecting");
    const seconds = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)] ?? 30;
    attempt += 1;
    retry = setTimeout(() => void connect(), seconds * 1000);
  };

  const connect = async (): Promise<void> => {
    if (closed) return;
    emit(attempt === 0 ? "connecting" : "reconnecting");

    let path: string;
    try {
      const ticket = await terminalApi.ticket(name);
      path = ticket.path;
    } catch (error) {
      // The tab is gone (404) or another viewer detached it (409). Retrying
      // cannot fix either; polling the tab list shows the truth.
      if (isGone(error)) {
        teardown();
        return;
      }
      scheduleRetry();
      return;
    }
    if (closed) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(path));
      ws.binaryType = "arraybuffer";
    } catch {
      scheduleRetry();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      attempt = 0;
      emit("live");
    };
    ws.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) handlers.onData(new Uint8Array(event.data));
      // Text frames are server control; pty output is the only payload in v1.
    };
    ws.onerror = () => {
      // The close event that follows decides whether to retry.
    };
    ws.onclose = (event: CloseEvent) => {
      if (socket === ws) socket = undefined;
      if (closed) return;
      if (event.code === NORMAL_CLOSE) {
        teardown();
        return;
      }
      scheduleRetry();
    };
  };

  void connect();

  return {
    sendInput(bytes: Uint8Array<ArrayBuffer>): void {
      if (socket?.readyState === WebSocket.OPEN) socket.send(bytes);
    },
    sendResize(cols: number, rows: number): void {
      if (socket?.readyState !== WebSocket.OPEN) return;
      const frame: ResizeFrame = { t: "resize", cols, rows };
      socket.send(JSON.stringify(frame));
    },
    close: teardown,
  };
}

/** True for HTTP statuses that mean "this tab no longer exists". */
function isGone(error: unknown): boolean {
  return isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 409);
}
