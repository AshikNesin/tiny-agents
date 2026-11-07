/**
 * The VNC bridge every live desktop shares (the bot browser in
 * `browser.vnc.ts`, the bot computer in `computer.vnc.ts`): a WebSocket that
 * pipes the owner's noVNC viewer to an RFB server on the sandbox VM, through
 * an SSH channel. The server relays bytes untouched and never logs them
 * (they include everything the owner types during a takeover).
 *
 * The viewer first calls an authenticated ticket route and presents the
 * ticket here; tickets and the Origin check are shared with the terminal
 * bridge (../ws/upgrade.ts). Each kind caps its viewers per bot, pings, and
 * stops reading the VM while a slow viewer has 4 MB queued. An open viewer is
 * held as its ticket's live access (../people/live-access.ts): removing the
 * guest, or unsharing the bot, closes it with 1008.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "@groot/core/logger";
import { holdLiveAccess, type LiveGrant } from "../people/live-access";
import { isOriginAllowed, onUpgrade, rejectUpgrade, type TicketStore } from "../ws/upgrade";

const MAX_VIEWERS_PER_BOT = 4;
const PING_INTERVAL_MS = 30_000;
/** Stop reading the VM stream while this much is queued for a slow viewer. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

/** What a redeemed ticket resolves to: a stream to open, and activity to record. */
export interface VncTarget {
  openStream(): Promise<Duplex>;
  /** Called on every ping: an open viewer keeps its desktop from idling out. */
  touch(): void;
}

export interface VncBridgeOptions<T extends LiveGrant> {
  /**
   * The upgrade path; its first capture group is the scope the ticket must
   * be bound to (a bot id, or a desktop profile on the Computer page).
   */
  path: RegExp;
  /** The scope a ticket was issued for; also what the viewer cap counts by. */
  scope(ticket: T): string;
  tickets: TicketStore<T>;
  /** The live desktop a ticket names, or undefined when it is gone. */
  resolve(ticket: T): VncTarget | undefined;
  /** For logs and the close reason: "browser", "computer". */
  kind: string;
  isOriginAllowed?: (req: IncomingMessage) => boolean;
}

/**
 * Handle `upgrade` requests for one path on the app's HTTP server and leave
 * every other upgrade to its own listener. Returns a function that closes
 * every open viewer (graceful shutdown).
 */
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
      void bridge(ws, target, botId, options.kind).finally(() => {
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

/** How long a revoked viewer gets to answer the close before the socket is cut. */
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
): Promise<void> {
  let stream: Duplex;
  try {
    stream = await target.openStream();
  } catch (error) {
    logger.warn({ err: error, botId }, `${kind} VNC stream failed to open`);
    ws.close(1011, `Could not reach the ${kind} display`);
    return;
  }
  // The viewer left (or was revoked) while the stream opened: its close
  // event has already fired, so nothing below would ever end this bridge.
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
      // A closing viewer (revoked, say) no longer reaches the desktop.
      if (ws.readyState !== ws.OPEN) return;
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
