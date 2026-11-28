import { ApiError } from "@groot/shell/lib/api";
import { reconnectingSocket, type SocketState } from "./reconnecting-socket";
import { terminalApi } from "./terminal-api";

export type TerminalConnectionState = SocketState;

type ControlFrame =
  | { t: "resize"; cols: number; rows: number }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "ping" };

export interface TerminalHandlers {
  onData: (bytes: Uint8Array) => void;
  onStateChange: (state: TerminalConnectionState) => void;
  size?: () => { cols: number; rows: number } | null;
}

export interface TerminalConnection {
  sendInput(bytes: Uint8Array<ArrayBuffer>): void;
  sendResize(cols: number, rows: number): void;
  written(byteCount: number): void;
  close(): void;
}

const NORMAL_CLOSE = 1000;

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

export function connectTerminal(
  name: string,
  handlers: TerminalHandlers,
  signal?: AbortSignal,
): TerminalConnection {
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
        const abandon = () => {
          if (abandoned) return;
          abandoned = true;
          stopHeartbeat();
          ws.onopen = null;
          ws.onmessage = null;
          ws.onclose = null;
          ws.onerror = null;
          ws.close();
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
        };
        ws.onerror = () => {};
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

function isGone(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 409);
}
