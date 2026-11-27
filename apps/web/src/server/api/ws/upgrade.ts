import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { Boom } from "@groot/core/errors";
import { config } from "@groot/core/config";
import { env } from "@groot/core/env";
import { logger } from "@groot/core/logger";
import { holdLiveAccess, type LiveGrant } from "../people/live-access";
import { app } from "../../app-root";

export const TICKET_TTL_MS = 60_000;

export interface TicketStoreOptions {
  ttlMs?: number;
  perUserLimit?: number;
  limitMessage?: string;
}

export interface TicketStore<T extends LiveGrant> {
  issue(data: T): string;
  redeem(ticket: string, bound: (data: T) => boolean): T | undefined;
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
          throw Boom.tooManyRequests(
            options.limitMessage ?? "Too many tickets requested. Wait a moment.",
          );
        }
      }
      const ticket = randomBytes(24).toString("base64url");
      const entry = { data, expiresAt: now + ttl, release: () => {} };
      tickets.set(ticket, entry);
      entry.release = holdLiveAccess(data, () => tickets.delete(ticket));
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

export function rejectUpgrade(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export interface UpgradeMatch {
  req: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  url: URL;
  params: string[];
}

export function onUpgrade(
  httpServer: Server,
  pattern: RegExp,
  originAllowed: (req: IncomingMessage) => boolean,
  handle: (match: UpgradeMatch) => void,
): void {
  const patterns = app().upgradePatterns.get(httpServer) ?? [];
  app().upgradePatterns.set(httpServer, patterns);
  patterns.push(pattern);
  httpServer.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://internal");
    } catch {
      return rejectUpgrade(socket, "400 Bad Request");
    }
    try {
      const match = pattern.exec(url.pathname);
      if (!match) {
        const ours = app().upgradePatterns.get(httpServer) ?? [];
        const foreign = httpServer.listenerCount("upgrade") - ours.length;
        if (foreign <= 0 && !ours.some((p) => p.test(url.pathname))) socket.destroy();
        return;
      }
      if (!originAllowed(req)) return rejectUpgrade(socket, "403 Forbidden");
      let params: string[];
      try {
        params = match.slice(1).map(decodeURIComponent);
      } catch {
        return rejectUpgrade(socket, "400 Bad Request");
      }
      handle({ req, socket, head, url, params });
    } catch (error) {
      logger.warn({ err: error, path: url.pathname }, "Upgrade handler failed");
      rejectUpgrade(socket, "500 Internal Server Error");
    }
  });
}
