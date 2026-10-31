/**
 * Framework-free attach client for one terminal tab (issue #28): a
 * reconnecting socket (`reconnecting-socket.ts`) whose transport is a
 * WebSocket of binary pty frames. xterm wiring stays in the page; this
 * module owns what goes over the wire so it can be unit-tested without
 * React.
 */
import { ApiError } from "@groot/shell/lib/api";
import { reconnectingSocket, type SocketState } from "./reconnecting-socket";
import { terminalApi } from "./terminal-api";

export type TerminalConnectionState = SocketState;

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

/** Close code the server uses to end the connection cleanly. */
const NORMAL_CLOSE = 1000;

function wsUrl(path: string): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${path}`;
}

/**
 * Attach to tab `name`. Reconnects until `signal` aborts or `close()` is
 * called; a ticket fetch that fails with 404/409, or a socket the server
 * closes with 1000 (the tab was killed on the VM or never existed), gives
 * up immediately, otherwise every failure retries.
 */
export function connectTerminal(
  name: string,
  handlers: TerminalHandlers,
  signal?: AbortSignal,
): TerminalConnection {
  const socket = reconnectingSocket<{ path: string }, WebSocket>(
    {
      ticket: () => terminalApi.ticket(name),
      open: (ticket, events) => {
        const ws = new WebSocket(wsUrl(ticket.path));
        ws.binaryType = "arraybuffer";
        ws.onopen = () => events.live();
        ws.onmessage = (event: MessageEvent<unknown>) => {
          if (event.data instanceof ArrayBuffer) handlers.onData(new Uint8Array(event.data));
          // Text frames are server control; pty output is the only payload in v1.
        };
        ws.onerror = () => {
          // The close event that follows decides whether to retry.
        };
        ws.onclose = (event: CloseEvent) => {
          if (event.code === NORMAL_CLOSE) events.ended();
          else events.dropped();
        };
        return ws;
      },
      close: (ws) => {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      },
      gone: isGone,
    },
    handlers.onStateChange,
    signal,
  );

  const open = (): WebSocket | undefined => {
    const ws = socket.current();
    return ws?.readyState === WebSocket.OPEN ? ws : undefined;
  };

  return {
    sendInput(bytes: Uint8Array<ArrayBuffer>): void {
      open()?.send(bytes);
    },
    sendResize(cols: number, rows: number): void {
      const frame: ResizeFrame = { t: "resize", cols, rows };
      open()?.send(JSON.stringify(frame));
    },
    close: socket.close,
  };
}

/** True for HTTP statuses that mean "this tab no longer exists". */
function isGone(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 409);
}
