/**
 * What every ticketed WebSocket upgrade shares (the VNC bridge in
 * bots/browser.vnc.ts and the terminal bridge in terminal/terminal.ws.ts).
 *
 * Browsers cannot set headers on a WebSocket and the upgrade runs outside
 * the Hono app, so a page first calls an authenticated ticket route and
 * presents the ticket on the socket URL. Tickets are opaque random strings
 * (never a JWT: the session secret would also verify them as login
 * tokens), single-use, bound to one target, and expire after a minute.
 * An unredeemed ticket is held as live access (../people/live-access.ts):
 * removing its guest, or unsharing its bot, spends it.
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { Boom } from "@groot/core/errors";
import { config } from "@groot/core/config";
import { env } from "@groot/core/env";
import { holdLiveAccess, type LiveGrant } from "../people/live-access";

export const TICKET_TTL_MS = 60_000;

export interface TicketStoreOptions {
  ttlMs?: number;
  /** Live tickets one user may hold at once; past it, `issue` throws 429. */
  perUserLimit?: number;
  limitMessage?: string;
}

export interface TicketStore<T extends LiveGrant> {
  issue(data: T): string;
  /** Single use: a redeemed (or expired, or mismatched) ticket is gone either way. */
  redeem(ticket: string, bound: (data: T) => boolean): T | undefined;
  /** Tests. */
  reset(): void;
}

export function createTicketStore<T extends LiveGrant>(
  options: TicketStoreOptions = {},
): TicketStore<T> {
  const ttl = options.ttlMs ?? TICKET_TTL_MS;
  const tickets = new Map<string, { data: T; expiresAt: number; release(): void }>();
  const spend = (key: string) => {
    tickets.get(key)?.release();
    tickets.delete(key);
  };
  const sweep = (now: number) => {
    for (const [key, ticket] of tickets) if (ticket.expiresAt <= now) spend(key);
  };
  return {
    issue(data) {
      const now = Date.now();
      sweep(now);
      if (options.perUserLimit !== undefined) {
        const held = [...tickets.values()].filter((t) => t.data.userId === data.userId).length;
        if (held >= options.perUserLimit) {
          // 429, not 409: clients read 409 as "target gone, stop forever".
          throw Boom.tooManyRequests(
            options.limitMessage ?? "Too many tickets requested. Wait a moment.",
          );
        }
      }
      const ticket = randomBytes(24).toString("base64url");
      const release = holdLiveAccess(data, () => tickets.delete(ticket));
      tickets.set(ticket, { data, expiresAt: now + ttl, release });
      return ticket;
    },
    redeem(ticket, bound) {
      const found = tickets.get(ticket);
      spend(ticket);
      if (!found || found.expiresAt <= Date.now() || !bound(found.data)) return undefined;
      return found.data;
    },
    reset() {
      for (const key of [...tickets.keys()]) spend(key);
    },
  };
}

/**
 * The default Origin policy: same-host, a configured CORS origin, or
 * env.ORIGIN. Browsers send Origin on WebSocket handshakes; a foreign one is
 * refused. No Origin means a non-browser client, where the ticket is the
 * credential.
 */
export function isOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
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

/** Refuse an upgrade with a bare HTTP status line and close the socket. */
export function rejectUpgrade(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export interface UpgradeMatch {
  req: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  url: URL;
  /** The path pattern's capture groups. */
  params: string[];
}

/**
 * Handle `upgrade` requests whose path matches `pattern`, after the Origin
 * check, and leave every other upgrade (Vite's HMR socket in dev, the other
 * bridge) to its own listener. An upgrade nobody listens for is closed
 * instead of left hanging.
 */
/** The paths `onUpgrade` serves on each server, so a stray upgrade is dropped once none match. */
const upgradePatterns = new WeakMap<Server, RegExp[]>();

export function onUpgrade(
  httpServer: Server,
  pattern: RegExp,
  originAllowed: (req: IncomingMessage) => boolean,
  handle: (match: UpgradeMatch) => void,
): void {
  const patterns = upgradePatterns.get(httpServer) ?? [];
  upgradePatterns.set(httpServer, patterns);
  patterns.push(pattern);
  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://internal");
    const match = pattern.exec(url.pathname);
    if (!match) {
      // Nobody answers it: none of our paths match and no other listener
      // (Vite's HMR, say) is attached to take it.
      const ours = upgradePatterns.get(httpServer) ?? [];
      const foreign = httpServer.listenerCount("upgrade") - ours.length;
      if (foreign <= 0 && !ours.some((p) => p.test(url.pathname))) socket.destroy();
      return;
    }
    if (!originAllowed(req)) return rejectUpgrade(socket, "403 Forbidden");
    handle({ req, socket, head, url, params: match.slice(1).map(decodeURIComponent) });
  });
}
