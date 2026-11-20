import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "@groot/core/logger";
import { holdLiveAccess, type LiveGrant } from "../people/live-access";
import { createRfbInputWatch, createRfbViewOnlyFilter, RfbViewOnlyError } from "./rfb-view-only";
import { isOriginAllowed, onUpgrade, rejectUpgrade, type TicketStore } from "../ws/upgrade";

const MAX_VIEWERS_PER_BOT = 4;
const PING_INTERVAL_MS = 30_000;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export interface VncTarget {
  openStream(): Promise<Duplex>;
  touch(): void;
  ownerInput(): void;
}

export interface VncBridgeOptions<T extends LiveGrant> {
  path: RegExp;
  scope(ticket: T): string;
  tickets: TicketStore<T>;
  resolve(ticket: T): VncTarget | undefined;
  kind: string;
  isOriginAllowed?: (req: IncomingMessage) => boolean;
}

export function attachVncBridge<T extends LiveGrant>(
  httpServer: Server,
  options: VncBridgeOptions<T>,
): { close(): void } {
  const wss = new WebSocketServer({ noServer: true });
  const originAllowed = options.isOriginAllowed ?? isOriginAllowed;
  const viewers = new Map<string, number>();

  onUpgrade(httpServer, options.path, originAllowed, ({ req, socket, head, url, params }) => {
    const botId = params[0]!;
    const ticket = options.tickets.redeem(
      url.searchParams.get("ticket") ?? "",
      (found) => options.scope(found) === botId,
    );
    if (!ticket) return rejectUpgrade(socket, "401 Unauthorized");

    const target = options.resolve(ticket);
    if (!target) return rejectUpgrade(socket, "404 Not Found");
    if ((viewers.get(botId) ?? 0) >= MAX_VIEWERS_PER_BOT) {
      return rejectUpgrade(socket, "429 Too Many Requests");
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      viewers.set(botId, (viewers.get(botId) ?? 0) + 1);
      const release = holdLiveAccess(ticket, () => revoke(ws));
      void bridge(ws, target, botId, options.kind, ticket.viewOnly === true).finally(() => {
        release();
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

const REVOKE_CLOSE_GRACE_MS = 1_000;

function revoke(ws: WebSocket): void {
  ws.close(1008, "Access removed");
  setTimeout(() => ws.terminate(), REVOKE_CLOSE_GRACE_MS).unref();
}

async function bridge(
  ws: WebSocket,
  target: VncTarget,
  botId: string,
  kind: string,
  viewOnly: boolean,
): Promise<void> {
  const filter = viewOnly ? createRfbViewOnlyFilter() : undefined;
  const watch = viewOnly ? undefined : createRfbInputWatch(() => target.ownerInput());
  let stream: Duplex;
  try {
    stream = await target.openStream();
  } catch (error) {
    logger.warn({ err: error, botId }, `${kind} VNC stream failed to open`);
    ws.close(1011, `Could not reach the ${kind} display`);
    return;
  }
  if (ws.readyState !== ws.OPEN) {
    stream.destroy();
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
      target.touch();
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
      if (ws.readyState !== ws.OPEN) return;
      const raw = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      let bytes = raw;
      if (filter) {
        try {
          bytes = filter.push(raw);
        } catch (error) {
          if (!(error instanceof RfbViewOnlyError)) throw error;
          ws.close(1008, "View only");
          return;
        }
        if (bytes.length === 0) return;
      }
      watch?.push(raw);
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
