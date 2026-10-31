/**
 * VNC bridge for the bot browser: a WebSocket that pipes the owner's noVNC
 * viewer to the RFB server on the sandbox VM, through the SSH channel the
 * browser session already owns. The server relays bytes untouched and never
 * logs them (they include everything the owner types during a takeover).
 *
 * The viewer first calls the authenticated `POST /bots/:id/browser/vnc-ticket`
 * and presents the ticket here; tickets and the Origin check are shared with
 * the terminal bridge (../ws/upgrade.ts).
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "@groot/core/logger";
import { getLiveBrowserSession, type BrowserTarget } from "@tiny-agents/agent";
import { createTicketStore, isOriginAllowed, onUpgrade, rejectUpgrade } from "../ws/upgrade";

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
}

const tickets = createTicketStore<Ticket>();

export function issueVncTicket(input: Ticket): string {
  return tickets.issue(input);
}

/** Single use: a redeemed (or expired) ticket is gone either way. */
export function redeemVncTicket(ticket: string, botId: string): Ticket | undefined {
  return tickets.redeem(ticket, (found) => found.botId === botId);
}

export function resetVncTicketsForTests(): void {
  tickets.reset();
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

  onUpgrade(httpServer, PATH, originAllowed, ({ req, socket, head, url, params }) => {
    const botId = params[0]!;
    const ticket = redeemVncTicket(url.searchParams.get("ticket") ?? "", botId);
    if (!ticket) return rejectUpgrade(socket, "401 Unauthorized");

    const live = getLiveBrowserSession(ticket.target);
    const vnc = live?.session.vnc;
    if (!live || !vnc) return rejectUpgrade(socket, "404 Not Found");
    if ((viewers.get(botId) ?? 0) >= MAX_VIEWERS_PER_BOT) {
      return rejectUpgrade(socket, "429 Too Many Requests");
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
