/**
 * Framework-free attach client for one terminal tab (issue #28): a
 * reconnecting socket (`reconnecting-socket.ts`) whose transport is a
 * WebSocket of binary pty frames. xterm wiring stays in the page; this
 * module owns what goes over the wire so it can be unit-tested without
 * React.
 *
 * Beyond the bytes it keeps the stream healthy:
 * - Initial size rides on the URL, so tmux attaches at the grid the owner
 *   sees instead of 120x34 followed by a resize (a full-screen redraw).
 * - Flow control: bytes received but not yet parsed by xterm are counted;
 *   past a high watermark the server is told to stop reading the VM, and
 *   below a low one to resume. `cat` of a huge log no longer freezes the
 *   tab while xterm chews through megabytes it was handed at once.
 * - Heartbeat: while the page is visible a ping goes out every 20s and on
 *   every return to the page. No pong in time means the socket is
 *   half-open (a laptop that slept, a proxy that dropped it silently), so it
 *   is abandoned and the reconnect starts at once, not when TCP gives up.
 *   Hidden pages send no pings, so the server's idle timer still frees tabs
 *   nobody is looking at.
 */
import { ApiError } from "@groot/shell/lib/api";
import { reconnectingSocket, type SocketState } from "./reconnecting-socket";
import { terminalApi } from "./terminal-api";

export type TerminalConnectionState = SocketState;

/** Text frames the protocol defines; binary frames are pty bytes. */
export type ControlFrame =
  | { t: "resize"; cols: number; rows: number }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "ping" };

export interface TerminalHandlers {
  onData: (bytes: Uint8Array) => void;
  onStateChange: (state: TerminalConnectionState) => void;
  /** The grid to attach at; read on every (re)connect. */
  size?: () => { cols: number; rows: number } | null;
}

export interface TerminalConnection {
  /** Keystrokes as pty bytes. No-op until the socket is open. */
  sendInput(bytes: Uint8Array<ArrayBuffer>): void;
  /** Tell the server (and tmux) the grid changed. */
  sendResize(cols: number, rows: number): void;
  /** xterm finished parsing `byteCount` bytes handed to it by onData. */
  written(byteCount: number): void;
  /** Stops the socket and any pending retry; state becomes "closed". */
  close(): void;
}

/** Close code the server uses to end the connection cleanly. */
const NORMAL_CLOSE = 1000;

/** Unparsed bytes at which the server is paused, and resumed. */
export const HIGH_WATERMARK = 512 * 1024;
export const LOW_WATERMARK = 64 * 1024;

export const PING_INTERVAL_MS = 20_000;
export const PONG_TIMEOUT_MS = 8_000;

function wsUrl(path: string, size: { cols: number; rows: number } | null): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const url = new URL(`${scheme}://${window.location.host}${path}`);
  if (size) {
    url.searchParams.set("cols", String(size.cols));
    url.searchParams.set("rows", String(size.rows));
  }
  return url.toString();
}

const visible = (): boolean =>
  typeof document === "undefined" || document.visibilityState !== "hidden";

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
  // Flow-control state is per socket: a new attach starts unpaused. Bytes
  // from an older socket acknowledged late only make a resume come early.
  let pending = 0;
  let paused = false;
  const stopHeartbeats = new WeakMap<WebSocket, () => void>();

  const sendControl = (ws: WebSocket | undefined, frame: ControlFrame): void => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  };

  const socket = reconnectingSocket<{ path: string }, WebSocket>(
    {
      ticket: () => terminalApi.ticket(name),
      open: (ticket, events) => {
        const ws = new WebSocket(wsUrl(ticket.path, handlers.size?.() ?? null));
        ws.binaryType = "arraybuffer";
        pending = 0;
        paused = false;

        let pingTimer: ReturnType<typeof setInterval> | undefined;
        let pongTimer: ReturnType<typeof setTimeout> | undefined;
        let abandoned = false;

        const stopHeartbeat = () => {
          clearInterval(pingTimer);
          clearTimeout(pongTimer);
          pongTimer = undefined;
          document.removeEventListener("visibilitychange", onVisibility);
        };
        // A missed pong: stop listening to this socket and reconnect now.
        const abandon = () => {
          if (abandoned) return;
          abandoned = true;
          stopHeartbeat();
          ws.onopen = null;
          ws.onmessage = null;
          ws.onclose = null;
          ws.onerror = null;
          try {
            ws.close();
          } catch {
            // Already closing.
          }
          events.dropped();
        };
        const probe = () => {
          if (!visible() || ws.readyState !== WebSocket.OPEN || pongTimer) return;
          sendControl(ws, { t: "ping" });
          pongTimer = setTimeout(abandon, PONG_TIMEOUT_MS);
        };
        function onVisibility() {
          if (visible()) probe();
        }

        ws.onopen = () => {
          events.live();
          pingTimer = setInterval(probe, PING_INTERVAL_MS);
          document.addEventListener("visibilitychange", onVisibility);
        };
        ws.onmessage = (event: MessageEvent<unknown>) => {
          // Any frame proves the socket is alive.
          clearTimeout(pongTimer);
          pongTimer = undefined;
          if (event.data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(event.data);
            pending += bytes.byteLength;
            if (!paused && pending > HIGH_WATERMARK) {
              paused = true;
              sendControl(ws, { t: "pause" });
            }
            handlers.onData(bytes);
          }
          // Text frames are server control ({t:"pong"}); nothing else to do.
        };
        ws.onerror = () => {
          // The close event that follows decides whether to retry.
        };
        ws.onclose = (event: CloseEvent) => {
          stopHeartbeat();
          if (event.code === NORMAL_CLOSE) events.ended();
          else events.dropped();
        };
        stopHeartbeats.set(ws, stopHeartbeat);
        return ws;
      },
      close: (ws) => {
        stopHeartbeats.get(ws)?.();
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
      sendControl(open(), { t: "resize", cols, rows });
    },
    written(byteCount: number): void {
      pending = Math.max(0, pending - byteCount);
      if (paused && pending < LOW_WATERMARK) {
        paused = false;
        sendControl(open(), { t: "resume" });
      }
    },
    close: socket.close,
  };
}

/** True for HTTP statuses that mean "this tab no longer exists". */
function isGone(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 409);
}
