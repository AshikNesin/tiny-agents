import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "@groot/core/logger";
import { parseSessionName, type PtyStream, type SessionName } from "@tiny-agents/sandbox/terminal";
import { createTicketStore, isOriginAllowed, onUpgrade, rejectUpgrade } from "../ws/upgrade";
import { getTerminalService } from "./terminal.instance";

const PING_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_MS = 10 * 60_000;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const TICKET_RATE_LIMIT = 30;

const PATH = /^\/api\/v1\/terminal\/ws\/([^/]+)$/;

const clampCols = (n: number) => Math.min(500, Math.max(2, n));
const clampRows = (n: number) => Math.min(300, Math.max(2, n));

interface Ticket {
  userId: number;
  name: SessionName;
}

const tickets = createTicketStore<Ticket>({
  perUserLimit: TICKET_RATE_LIMIT,
  limitMessage: "Too many terminal tickets requested. Wait a moment.",
});

export function issueTerminalTicket(input: Ticket): string {
  return tickets.issue(input);
}

export function redeemTerminalTicket(ticket: string, name: SessionName): Ticket | undefined {
  return tickets.redeem(ticket, (found) => found.name === name);
}

export function resetTerminalTicketsForTests(): void {
  tickets.reset();
}

export interface TerminalWsOptions {
  isOriginAllowed?: (req: IncomingMessage) => boolean;
}

export function attachTerminalWs(
  httpServer: Server,
  options: TerminalWsOptions = {},
): { close(): void } {
  const wss = new WebSocketServer({ noServer: true });
  const originAllowed = options.isOriginAllowed ?? isOriginAllowed;

  onUpgrade(httpServer, PATH, originAllowed, ({ req, socket, head, url, params }) => {
    const name = parseSessionName(params[0]!);
    if (!name) return rejectUpgrade(socket, "400 Bad Request");
    const ticket = redeemTerminalTicket(url.searchParams.get("ticket") ?? "", name);
    if (!ticket) return rejectUpgrade(socket, "401 Unauthorized");

    const cols = clampCols(Number(url.searchParams.get("cols") ?? 120) || 120);
    const rows = clampRows(Number(url.searchParams.get("rows") ?? 34) || 34);

    wss.handleUpgrade(req, socket, head, (ws) => {
      void bridge(ws, name, cols, rows);
    });
  });

  return {
    close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}

async function bridge(ws: WebSocket, name: SessionName, cols: number, rows: number): Promise<void> {
  let stream: PtyStream;
  try {
    stream = await getTerminalService().attach(name, { cols, rows });
  } catch (error) {
    logger.warn({ err: error, session: name }, "Terminal attach failed");
    ws.close(1011, "Could not attach the terminal session");
    return;
  }

  await new Promise<void>((resolve) => {
    let alive = true;
    let idleTimer = armIdleTimer(ws);
    let socketFull = false;
    let clientPaused = false;
    const syncFlow = () => {
      if (socketFull || clientPaused) stream.pause();
      else stream.resume();
    };

    const ping = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, PING_INTERVAL_MS);
    ws.on("pong", () => {
      alive = true;
    });

    const bumpIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = armIdleTimer(ws);
    };

    stream.on("data", (chunk: Buffer) => {
      if (ws.readyState !== ws.OPEN) return;
      bumpIdle();
      ws.send(chunk, { binary: true }, () => {
        if (socketFull && ws.bufferedAmount < MAX_BUFFERED_BYTES) {
          socketFull = false;
          syncFlow();
        }
      });
      if (ws.bufferedAmount >= MAX_BUFFERED_BYTES) {
        socketFull = true;
        syncFlow();
      }
    });
    ws.on("message", (data, isBinary) => {
      bumpIdle();
      if (isBinary) {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data as ArrayBuffer);
        if (!stream.write(bytes)) {
          ws.pause();
          stream.once("drain", () => ws.resume());
        }
        return;
      }
      const control = parseControl(String(data));
      if (!control) return;
      switch (control.t) {
        case "resize":
          stream.setWindow(clampRows(control.rows), clampCols(control.cols));
          return;
        case "pause":
        case "resume":
          clientPaused = control.t === "pause";
          syncFlow();
          return;
        case "ping":
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "pong" }));
          return;
      }
    });

    const finish = () => {
      clearInterval(ping);
      clearTimeout(idleTimer);
      stream.destroy();
      resolve();
    };
    stream.once("close", () => {
      if (ws.readyState === ws.OPEN) ws.close(1000, "Terminal session ended");
      finish();
    });
    stream.on("error", () => {
      if (ws.readyState === ws.OPEN) ws.close(1000, "Terminal session ended");
      finish();
    });
    ws.once("close", finish);
    ws.on("error", () => undefined);
  });
}

type ControlFrame =
  | { t: "resize"; cols: number; rows: number }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "ping" };

function parseControl(message: string): ControlFrame | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const frame = parsed as { t?: unknown; cols?: unknown; rows?: unknown };
  switch (frame.t) {
    case "resize":
      return typeof frame.cols === "number" &&
        typeof frame.rows === "number" &&
        Number.isFinite(frame.cols) &&
        Number.isFinite(frame.rows)
        ? { t: "resize", cols: frame.cols, rows: frame.rows }
        : undefined;
    case "pause":
    case "resume":
    case "ping":
      return { t: frame.t };
    default:
      return undefined;
  }
}

function armIdleTimer(ws: WebSocket): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    ws.close(4000, "Terminal idle");
  }, IDLE_TIMEOUT_MS);
}
