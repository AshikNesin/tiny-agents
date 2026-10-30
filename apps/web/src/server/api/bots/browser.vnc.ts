/**
 * VNC bridge for the bot browser: a WebSocket that pipes the owner's noVNC
 * viewer to the RFB server on the sandbox VM, through the SSH channel the
 * browser session already owns. The server relays bytes untouched and never
 * logs them (they include everything the owner types during a takeover).
 *
 * Browsers cannot set headers on a WebSocket, and the upgrade runs outside
 * the Hono app, so the viewer first calls the authenticated
 * `POST /bots/:id/browser/vnc-ticket` and presents the ticket here. Tickets
 * are opaque random strings (never a JWT: the session secret would also
 * verify them as login tokens), single-use, bound to one bot, and expire in
 * 60 seconds.
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "@groot/core/config";
import { env } from "@groot/core/env";
import { logger } from "@groot/core/logger";
import { getLiveBrowserSession, type BrowserTarget } from "@tiny-agents/agent";

const TICKET_TTL_MS = 60_000;
const MAX_VIEWERS_PER_BOT = 4;
const PING_INTERVAL_MS = 30_000;
/** Stop reading the VM stream while this much is queued for a slow viewer. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

const PATH = /^\/api\/v1\/bots\/([^/]+)\/browser\/vnc$/;

interface Ticket {
  userId: number;
  botId: string;
  /** The bot's browser (its profile) and tab. */
  target: BrowserTarget;
  expiresAt: number;
}

const tickets = new Map<string, Ticket>();

export function issueVncTicket(input: Omit<Ticket, "expiresAt">): string {
  const now = Date.now();
  for (const [key, ticket] of tickets) if (ticket.expiresAt <= now) tickets.delete(key);
  const ticket = randomBytes(24).toString("base64url");
  tickets.set(ticket, { ...input, expiresAt: now + TICKET_TTL_MS });
  return ticket;
}

/** Single use: a redeemed (or expired) ticket is gone either way. */
export function redeemVncTicket(ticket: string, botId: string): Ticket | undefined {
  const found = tickets.get(ticket);
  tickets.delete(ticket);
  if (!found || found.expiresAt <= Date.now() || found.botId !== botId) return undefined;
  return found;
}

export function resetVncTicketsForTests(): void {
  tickets.clear();
}

/**
 * The default Origin policy, exported for the terminal WebSocket bridge:
 * same-host, configured CORS origin, or env.ORIGIN. Browsers send Origin on
 * WebSocket handshakes; a foreign one is refused.
 */
export function isOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client; the ticket is the credential
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const hosts = [req.headers.host, req.headers["x-forwarded-host"]]
    .flat()
    .filter((h): h is string => typeof h === "string")
    .map((h) => h.split(",")[0]!.trim().toLowerCase());
  if (hosts.includes(originHost)) return true;
  if (config.cors.origins.includes(origin)) return true;
  if (!env.ORIGIN) return false;
  try {
    return new URL(env.ORIGIN).host.toLowerCase() === originHost;
  } catch {
    return false;
  }
}

function reject(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export interface BrowserVncOptions {
  isOriginAllowed?: (req: IncomingMessage) => boolean;
}

/**
 * Handle `upgrade` requests for the VNC path on the app's HTTP server and
 * leave every other upgrade (Vite's HMR socket in dev) to its own listener.
 * Returns a function that closes every open viewer (graceful shutdown).
 */
export function attachBrowserVnc(
  httpServer: Server,
  options: BrowserVncOptions = {},
): { close(): void } {
  const wss = new WebSocketServer({ noServer: true });
  const originAllowed = options.isOriginAllowed ?? isOriginAllowed;
  const viewers = new Map<string, number>();

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://internal");
    const match = PATH.exec(url.pathname);
    if (!match) {
      // Nobody else listening for upgrades means nobody will ever answer;
      // close instead of leaving the socket hanging.
      if (httpServer.listenerCount("upgrade") <= 1) socket.destroy();
      return;
    }
    if (!originAllowed(req)) return reject(socket, "403 Forbidden");

    const botId = decodeURIComponent(match[1]!);
    const ticket = redeemVncTicket(url.searchParams.get("ticket") ?? "", botId);
    if (!ticket) return reject(socket, "401 Unauthorized");

    const live = getLiveBrowserSession(ticket.target);
    const vnc = live?.session.vnc;
    if (!live || !vnc) return reject(socket, "404 Not Found");
    if ((viewers.get(botId) ?? 0) >= MAX_VIEWERS_PER_BOT) {
      return reject(socket, "429 Too Many Requests");
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      viewers.set(botId, (viewers.get(botId) ?? 0) + 1);
      void bridge(ws, vnc.openStream, ticket.target, botId).finally(() => {
        const left = (viewers.get(botId) ?? 1) - 1;
        if (left > 0) viewers.set(botId, left);
        else viewers.delete(botId);
      });
    });
  });

  return {
    close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}

async function bridge(
  ws: WebSocket,
  openStream: () => Promise<Duplex>,
  target: BrowserTarget,
  botId: string,
): Promise<void> {
  let stream: Duplex;
  try {
    stream = await openStream();
  } catch (error) {
    logger.warn({ err: error, botId }, "Browser VNC stream failed to open");
    ws.close(1011, "Could not reach the browser display");
    return;
  }

  await new Promise<void>((resolve) => {
    let alive = true;
    const ping = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
      // An open viewer counts as activity: the idle sweeper must not close
      // a browser someone is watching.
      const live = getLiveBrowserSession(target);
      if (live) live.lastActivity = Date.now();
    }, PING_INTERVAL_MS);
    ws.on("pong", () => {
      alive = true;
    });

    stream.on("data", (chunk: Buffer) => {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(chunk, { binary: true }, () => {
        if (ws.bufferedAmount < MAX_BUFFERED_BYTES) stream.resume();
      });
      if (ws.bufferedAmount >= MAX_BUFFERED_BYTES) stream.pause();
    });
    ws.on("message", (data) => {
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      if (!stream.write(bytes)) {
        ws.pause();
        stream.once("drain", () => ws.resume());
      }
    });

    const finish = () => {
      clearInterval(ping);
      stream.destroy();
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
      resolve();
    };
    stream.once("close", finish);
    stream.on("error", () => undefined);
    ws.once("close", finish);
    ws.on("error", () => undefined);
  });
}
