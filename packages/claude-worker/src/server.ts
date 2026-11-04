/**
 * Loopback WebSocket server. Bind address is fixed at 127.0.0.1.
 * The app starts it on the sandbox and reaches it through an SSH tunnel;
 * it is never published on a public port.
 * The bearer token is checked before the upgrade completes.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { assertNoOverrides } from "./guards";
import { assertSubscriptionLogin, type ClaudeAuthStatus } from "./auth";
import { parseClientMessage, type Timings, type WorkerMessage } from "./protocol";
import { SessionBook, SessionLimitError, type QueryFactory, type SessionOpen } from "./sessions";
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
  const book = new SessionBook(options.query, options.timings, options.arm);
  const sockets = new Set<WebSocket>();

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
    let lastRx = now();
    const mark = () => {
      lastRx = now();
    };
    const send = (message: WorkerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };
    send({ type: "welcome" });
    const timer = setInterval(() => {
      if (now() - lastRx >= options.timings.silenceCloseMs) {
        ws.close(4408, "silence");
        return;
      }
      if (ws.readyState === ws.OPEN) {
        ws.ping();
        send({ type: "ping" });
      }
    }, options.timings.pingIntervalMs);

    ws.on("pong", mark);
    ws.on("message", (data) => {
      mark();
      void onMessage(String(data), send, book, options, now);
    });
    ws.on("close", () => {
      clearInterval(timer);
      sockets.delete(ws);
    });
  });

  const sweep = setInterval(() => book.sweep(now()), options.sweepMs ?? 60_000);
  sweep.unref?.();

  const broadcast = (sessionId: string) => {
    const session = book.get(sessionId);
    if (!session) return;
    session.fanout = (event) => {
      const message: WorkerMessage = {
        type: "event",
        sessionId: event.sessionId,
        seq: event.seq,
        event: event.event,
      };
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      }
    };
  };

  async function onMessage(
    raw: string,
    send: (message: WorkerMessage) => void,
    sessions: SessionBook,
    opts: ClaudeWorkerServerOptions,
    clock: () => number,
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      send({ type: "error", code: "bad_message", message: "Message is not JSON." });
      return;
    }
    if (parsed && typeof parsed === "object" && (parsed as { type?: string }).type === "pong")
      return;
    const message = parseClientMessage(parsed);
    if (!message) {
      send({ type: "error", code: "bad_message", message: "Message does not match the protocol." });
      return;
    }
    if (message.type === "ping") {
      send({ type: "pong" });
      return;
    }
    if (message.type === "pong") return;
    if (message.type === "resume") {
      for (const event of sessions.replay(message.sessionId, message.afterSeq)) {
        send({ type: "event", sessionId: event.sessionId, seq: event.seq, event: event.event });
      }
      return;
    }
    if (message.type === "abort") {
      sessions.get(message.sessionId)?.abortTurn();
      return;
    }
    if (message.type === "tool_result") {
      sessions.settle(message.sessionId, message.toolUseId, {
        content: message.content,
        ...(message.isError ? { isError: true } : {}),
      });
      return;
    }
    const open: SessionOpen = {
      sessionId: message.sessionId,
      model: message.model,
      system: message.system,
      resume: message.resume,
      tools: message.tools ?? sessions.get(message.sessionId)?.tools ?? [],
    };
    broadcast(message.sessionId);
    try {
      assertNoOverrides(opts.env ?? process.env);
      const status = await opts.authStatus();
      assertSubscriptionLogin(status);
      const session = sessions.open(open, clock());
      broadcast(session.id);
      await sessions.runTurn(
        open,
        { turnId: message.turnId, text: message.text, images: message.images },
        clock(),
      );
    } catch (error) {
      const code = error instanceof SessionLimitError ? error.code : "rejected";
      const text = error instanceof Error ? error.message : String(error);
      send({
        type: "error",
        code,
        message: text,
        sessionId: message.sessionId,
        turnId: message.turnId,
      });
    }
  }

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
