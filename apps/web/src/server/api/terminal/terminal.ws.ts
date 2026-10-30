/**
 * Terminal WebSocket bridge (issue #28): pipes a browser xterm.js tab to a
 * tmux attach on the sandbox VM. Same shape as the VNC bridge
 * (browser.vnc.ts): browsers cannot set WS headers, so the page first calls
 * the JWT-protected ticket route and presents the ticket here. Binary
 * frames are raw pty bytes both ways and are never logged — they are
 * everything the owner types.
 *
 * Close codes are a contract with the client's reconnect logic:
 *   1000 permanent — another viewer detached us, the tmux session died, or
 *        it never existed (tmux's "can't find session" reaches the pane
 *        first); the client stops, the tab strip shows it.
 *   4000 idle      — ten minutes with no frames either way; the client
 *        reconnects with a fresh ticket when the user returns.
 *   1011 attach    — the SSH attach failed after the ticket was spent (the
 *        sandbox is unreachable); the client retries with backoff.
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { isOriginAllowed } from "../bots/browser.vnc";
import { parseSessionName, type PtyStream, type SessionName } from "@tiny-agents/agent";
import { getTerminalService } from "./terminal.instance";

const TICKET_TTL_MS = 60_000;
const PING_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_MS = 10 * 60_000;
/** Stop reading the VM while this much is queued for a slow client. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
/** Ticket mints per user per minute; the answer to abuse is 429, never 409. */
const TICKET_RATE_LIMIT = 30;

const PATH = /^\/api\/v1\/terminal\/ws\/([^/]+)$/;

/** Clamp bounds shared with the REST create route (the client mirrors them). */
const clampCols = (n: number) => Math.min(500, Math.max(2, n));
const clampRows = (n: number) => Math.min(300, Math.max(2, n));

interface Ticket {
  userId: number;
  name: SessionName;
  expiresAt: number;
}

const tickets = new Map<string, Ticket>();

export function issueTerminalTicket(input: Omit<Ticket, "expiresAt">): string {
  const now = Date.now();
  for (const [key, ticket] of tickets) if (ticket.expiresAt <= now) tickets.delete(key);
  const mints = [...tickets.values()].filter((t) => t.userId === input.userId).length;
  if (mints >= TICKET_RATE_LIMIT) {
    // 429, not 409: the client reads ticket-409 as "tab gone, stop forever".
    throw Boom.tooManyRequests("Too many terminal tickets requested. Wait a moment.");
  }
  const ticket = randomBytes(24).toString("base64url");
  tickets.set(ticket, { ...input, expiresAt: now + TICKET_TTL_MS });
  return ticket;
}

/** Single use: a redeemed (or expired) ticket is gone either way. */
export function redeemTerminalTicket(ticket: string, name: SessionName): Ticket | undefined {
  const found = tickets.get(ticket);
  tickets.delete(ticket);
  if (!found || found.expiresAt <= Date.now() || found.name !== name) return undefined;
  return found;
}

export function resetTerminalTicketsForTests(): void {
  tickets.clear();
}

function reject(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export interface TerminalWsOptions {
  isOriginAllowed?: (req: IncomingMessage) => boolean;
}

/**
 * Handle `upgrade` requests for the terminal path on the app's HTTP server
 * and leave every other upgrade (Vite HMR, the VNC bridge) to its own
 * listener. Returns a function that closes every attached tab.
 */
export function attachTerminalWs(
  httpServer: Server,
  options: TerminalWsOptions = {},
): { close(): void } {
  const wss = new WebSocketServer({ noServer: true });
  const originAllowed = options.isOriginAllowed ?? isOriginAllowed;

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://internal");
    const match = PATH.exec(url.pathname);
    if (!match) {
      // Nobody else listening for upgrades means nobody will ever answer.
      if (httpServer.listenerCount("upgrade") <= 1) socket.destroy();
      return;
    }
    if (!originAllowed(req)) return reject(socket, "403 Forbidden");

    const rawName = decodeURIComponent(match[1]!);
    const name = parseSessionName(rawName);
    if (!name) return reject(socket, "400 Bad Request");
    const ticket = redeemTerminalTicket(url.searchParams.get("ticket") ?? "", name);
    if (!ticket) return reject(socket, "401 Unauthorized");

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

    // Any frame either direction proves someone is at the keyboard.
    const bumpIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = armIdleTimer(ws);
    };

    stream.on("data", (chunk: Buffer) => {
      if (ws.readyState !== ws.OPEN) return;
      bumpIdle();
      ws.send(chunk, { binary: true }, () => {
        if (ws.bufferedAmount < MAX_BUFFERED_BYTES) stream.resume();
      });
      if (ws.bufferedAmount >= MAX_BUFFERED_BYTES) stream.pause();
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
      // Control frames: only resize exists in v1. Malformed or unknown
      // messages are ignored — a buggy client must not lose its terminal.
      const message = String(data);
      try {
        const parsed: unknown = JSON.parse(message);
        if (
          parsed &&
          typeof parsed === "object" &&
          "t" in parsed &&
          (parsed as { t?: unknown }).t === "resize" &&
          "cols" in parsed &&
          "rows" in parsed
        ) {
          const r = parsed as { cols: unknown; rows: unknown };
          if (
            typeof r.cols === "number" &&
            typeof r.rows === "number" &&
            Number.isFinite(r.cols) &&
            Number.isFinite(r.rows)
          ) {
            stream.setWindow(clampRows(r.rows), clampCols(r.cols));
          }
        }
      } catch {
        // not JSON: ignore
      }
    });

    const finish = () => {
      clearInterval(ping);
      clearTimeout(idleTimer);
      stream.destroy();
      resolve();
    };
    // The pty ended: the session was killed, or another viewer attached with
    // `-d` and detached this one. Either way the tab is not recoverable by
    // reconnecting — close 1000 so the client stops instead of retrying.
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

function armIdleTimer(ws: WebSocket): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    ws.close(4000, "Terminal idle");
  }, IDLE_TIMEOUT_MS);
}
