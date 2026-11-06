/**
 * Loopback WebSocket server. Bind address is fixed at 127.0.0.1.
 * The app starts it on the sandbox and reaches it through an SSH tunnel;
 * it is never published on a public port.
 * The bearer token is checked before the upgrade completes.
 *
 * This file owns the sockets: the bearer check, `welcome`, the heartbeat,
 * the silence close and the framing (`socket-handler.ts`). The protocols on
 * a socket are handlers (`bot-handler.ts`, `coding-handler.ts`) that answer
 * their own messages and subscribe their sockets to their sessions' logs.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClaudeAuthStatus } from "./auth";
import { createBotHandler } from "./bot-handler";
import { CodingBook } from "./coding";
import { createCodingHandler } from "./coding-handler";
import { DEFAULT_CODING_LIMITS, type CodingLimits } from "./coding-protocol";
import type { CodingSdk } from "./coding-sdk";
import { assertNoOverrides } from "./guards";
import type { Timings } from "./protocol";
import { SessionBook, type QueryFactory } from "./sessions";
import { Audience, Peer, type ProtocolHandler } from "./socket-handler";
import type { ArmTimer } from "./tool-proxy";

export interface ClaudeWorkerServerOptions {
  token: string;
  query: QueryFactory;
  /** Checked before a session process starts. Startup also checks in the bin. */
  authStatus: () => Promise<ClaudeAuthStatus>;
  env?: Record<string, string | undefined>;
  timings: Timings;
  /** Port 0 picks a free port (tests). */
  port?: number;
  now?: () => number;
  arm?: ArmTimer;
  /** Override the sweep interval. Default: once a minute. */
  sweepMs?: number;
  /**
   * Coding mode (the Code page's Claude Code threads), with its own caps.
   * Absent: `coding.*` requests answer `unavailable`.
   */
  coding?: {
    sdk: CodingSdk;
    limits?: CodingLimits;
    /** Default `~/.tiny-agents/uploads`. */
    uploadsDir?: string;
    /** Default the worker user's home (the directory browser starts here). */
    home?: string;
    schedule?: (fn: () => void, ms: number) => () => void;
  };
}

export interface ClaudeWorkerServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

const BIND_HOST = "127.0.0.1";

export function assertWorkerToken(token: string): void {
  if (!is32ByteSecret(token)) {
    throw new Error(
      "CLAUDE_WORKER_TOKEN must be a 32-byte secret (the app creates one on the sandbox).",
    );
  }
}

/** True for 32 raw bytes or a base64 encoding of exactly 32 bytes. */
export function is32ByteSecret(token: string): boolean {
  if (Buffer.byteLength(token) === 32) return true;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(token)) return false;
  const decoded = Buffer.from(token, "base64");
  if (decoded.length !== 32) return false;
  const canonical = decoded.toString("base64").replace(/=+$/, "");
  return canonical === token.replace(/=+$/, "");
}

export function bearerMatches(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function bearerOf(req: IncomingMessage): string {
  const header = req.headers.authorization;
  if (typeof header !== "string") return "";
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1] ?? "";
}

export async function createClaudeWorkerServer(
  options: ClaudeWorkerServerOptions,
): Promise<ClaudeWorkerServer> {
  assertWorkerToken(options.token);
  const env = options.env ?? process.env;
  assertNoOverrides(env);
  const now = options.now ?? Date.now;
  const bootId = randomUUID();
  const sockets = new Set<WebSocket>();
  const everyone = new Audience();
  const codingPeers = new Audience();
  const codingLimits = options.coding?.limits ?? DEFAULT_CODING_LIMITS;
  // The coding protocol claims `coding.*`; the bot protocol answers the rest.
  const handlers: ProtocolHandler[] = [
    createCodingHandler({
      book: options.coding
        ? new CodingBook({
            sdk: options.coding.sdk,
            env,
            limits: codingLimits,
            authStatus: options.authStatus,
            now,
            schedule: options.coding.schedule,
          })
        : undefined,
      audience: codingPeers,
      bootId,
      limits: codingLimits,
      uploadsDir: options.coding?.uploadsDir,
      home: options.coding?.home,
    }),
    createBotHandler({
      book: new SessionBook(options.query, options.timings, options.arm),
      everyone,
      env,
      authStatus: options.authStatus,
      now,
    }),
  ];

  const httpServer = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    if (!bearerMatches(bearerOf(req), options.token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    sockets.add(ws);
    const peer = new Peer(ws);
    everyone.add(peer);
    let lastRx = now();
    const mark = () => {
      lastRx = now();
    };
    peer.send({ type: "welcome", bootId });
    const timer = setInterval(() => {
      if (now() - lastRx >= options.timings.silenceCloseMs) {
        ws.close(4408, "silence");
        return;
      }
      if (ws.readyState === ws.OPEN) {
        ws.ping();
        peer.send({ type: "ping" });
      }
    }, options.timings.pingIntervalMs);

    ws.on("pong", mark);
    ws.on("message", (data) => {
      mark();
      void dispatch(String(data), peer);
    });
    ws.on("close", () => {
      clearInterval(timer);
      sockets.delete(ws);
      everyone.delete(peer);
      codingPeers.delete(peer);
    });
  });

  /** The envelope: JSON, then the heartbeat, then the protocol that claims the message. */
  async function dispatch(raw: string, peer: Peer): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      peer.send({ type: "error", code: "bad_message", message: "Message is not JSON." });
      return;
    }
    const frame = message && typeof message === "object" ? (message as { type?: unknown }) : {};
    if (frame.type === "pong") return;
    if (frame.type === "ping" && Object.keys(frame).length === 1) {
      peer.send({ type: "pong" });
      return;
    }
    await handlers.find((handler) => handler.claims(message))?.handle(message, peer);
  }

  const sweep = setInterval(() => {
    for (const handler of handlers) handler.sweep(now());
  }, options.sweepMs ?? 60_000);
  sweep.unref?.();

  await new Promise<void>((resolve) => {
    httpServer.listen(options.port ?? 0, BIND_HOST, () => resolve());
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    port,
    url: `ws://${BIND_HOST}:${port}`,
    close: () =>
      new Promise((resolve) => {
        clearInterval(sweep);
        for (const handler of handlers) handler.close();
        for (const socket of sockets) socket.close();
        wss.close();
        httpServer.close(() => resolve());
      }),
  };
}

/** Exposed for tests that check the bind address without accepting a socket. */
export function boundHost(server: HttpServer): string | undefined {
  const address = server.address();
  return typeof address === "object" && address ? address.address : undefined;
}
