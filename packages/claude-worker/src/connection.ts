import { WebSocket } from "ws";
import {
  replyFrameSchema,
  welcomeFrameSchema,
  type ReplyFrame,
  type ResumeResult,
} from "./envelope";
import { DEFAULT_TIMINGS, reconnectDelayMs } from "./protocol";

export interface WorkerTarget {
  url: string;
  token: string;
}

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  terminate?(): void;
  ping?(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

export type WorkerConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

export interface ConnectionTimings {
  pingIntervalMs: number;
  silenceCloseMs: number;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  requestTimeoutMs: number;
}

export const DEFAULT_CONNECTION_TIMINGS: ConnectionTimings = {
  pingIntervalMs: DEFAULT_TIMINGS.pingIntervalMs,
  silenceCloseMs: DEFAULT_TIMINGS.silenceCloseMs,
  reconnectMinMs: DEFAULT_TIMINGS.reconnectMinMs,
  reconnectMaxMs: DEFAULT_TIMINGS.reconnectMaxMs,
  requestTimeoutMs: 60_000,
};

export interface WorkerClock {
  now(): number;
  schedule(fn: () => void, ms: number): () => void;
}

export interface SessionStreams {
  event: string;
  resume: string;
  join: "start" | "now";
}

export interface WorkerFrame {
  type: string;
  [key: string]: unknown;
}

export interface WorkerConnectionOptions {
  sessions: SessionStreams;
  hello?: { type: string };
  onMessage(frame: WorkerFrame): void;
  onConnected?(rebooted: boolean, hello: unknown): void;
  onState?(state: WorkerConnectionState, detail: string | undefined): void;
  onResume?(sessionId: string, result: ResumeResult): void;
  onError?(message: string): void;
  timings?: Partial<ConnectionTimings>;
  socket?(target: WorkerTarget): WebSocketLike;
  clock?: WorkerClock;
}

export interface WorkerConnection {
  readonly state: WorkerConnectionState;
  readonly detail: string | undefined;
  send(message: object): boolean;
  request<T = unknown>(body: { type: string }, options?: { timeoutMs?: number }): Promise<T>;
  track(sessionId: string): void;
  close(): void;
}

export class WorkerRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkerRequestError";
  }
}

export function connectWorker(
  resolveTarget: () => Promise<WorkerTarget>,
  options: WorkerConnectionOptions,
): WorkerConnection {
  return new Connection(resolveTarget, options);
}

const OPEN = 1;
const LIVE_EDGE = Number.MAX_SAFE_INTEGER;

const realClock: WorkerClock = {
  now: () => Date.now(),
  schedule(fn, ms) {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

function wsSocket(target: WorkerTarget): WebSocketLike {
  return new WebSocket(target.url, {
    headers: { Authorization: `Bearer ${target.token}` },
  }) as unknown as WebSocketLike;
}

function end(socket: WebSocketLike): void {
  if (socket.terminate) socket.terminate();
  else socket.close();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Settle = (reply: ReplyFrame | Error | undefined) => void;

interface Pending {
  data: string;
  resend: boolean;
  sentOn: WebSocketLike | undefined;
  settle: Settle;
  cancelTimer: () => void;
}

interface Cursor {
  seq: number | undefined;
  resuming: boolean;
}

class Connection implements WorkerConnection {
  private socket: WebSocketLike | undefined;
  private ready = false;
  private closed = false;
  private connectedOnce = false;
  private attempt = 0;
  private lastRx = 0;
  private bootId: string | undefined;
  private failure: string | undefined;
  private stateNow: WorkerConnectionState = "connecting";
  private detailNow: string | undefined;
  private reconnectTimer: (() => void) | undefined;
  private heartbeatTimer: (() => void) | undefined;
  private handshakeTimer: (() => void) | undefined;
  private counter = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly cursors = new Map<string, Cursor>();
  private readonly queue: string[] = [];
  private readonly timings: ConnectionTimings;
  private readonly clock: WorkerClock;

  constructor(
    private readonly resolveTarget: () => Promise<WorkerTarget>,
    private readonly options: WorkerConnectionOptions,
  ) {
    this.timings = { ...DEFAULT_CONNECTION_TIMINGS, ...options.timings };
    this.clock = options.clock ?? realClock;
    void this.open();
  }

  get state(): WorkerConnectionState {
    return this.stateNow;
  }

  get detail(): string | undefined {
    return this.detailNow;
  }

  send(message: object): boolean {
    if (this.closed) return false;
    const data = JSON.stringify(message);
    const socket = this.socket;
    if (this.ready && socket?.readyState === OPEN) {
      socket.send(data);
      return true;
    }
    this.queue.push(data);
    return false;
  }

  request<T = unknown>(body: { type: string }, options: { timeoutMs?: number } = {}): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("The connection to the Claude worker is closed."));
    }
    return new Promise<T>((resolve, reject) => {
      this.issue(body, {
        resend: true,
        timeoutMs: options.timeoutMs,
        settle: (reply) => {
          if (reply === undefined) return;
          if (reply instanceof Error) reject(reply);
          else if (reply.ok) resolve(reply.result as T);
          else {
            reject(
              new WorkerRequestError(
                reply.error?.code ?? "failed",
                reply.error?.message ?? "The Claude worker refused the request.",
              ),
            );
          }
        },
      });
    });
  }

  track(sessionId: string): void {
    if (this.closed || this.cursors.has(sessionId)) return;
    this.cursors.set(sessionId, this.cursor());
    this.resume(sessionId);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.reconnectTimer?.();
    this.heartbeatTimer?.();
    this.handshakeTimer?.();
    const socket = this.socket;
    this.socket = undefined;
    this.ready = false;
    if (socket) end(socket);
    const closed = new Error("The connection to the Claude worker is closed.");
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.cancelTimer();
      pending.settle(pending.resend ? closed : undefined);
    }
    this.queue.length = 0;
    this.setState("closed", undefined);
  }

  private async open(): Promise<void> {
    if (this.closed) return;
    this.failure = undefined;
    let socket: WebSocketLike;
    try {
      const target = await this.resolveTarget();
      if (this.closed) return;
      socket = (this.options.socket ?? wsSocket)(target);
    } catch (error) {
      this.retry(messageOf(error));
      return;
    }
    this.socket = socket;
    this.lastRx = this.clock.now();
    const current = () => this.socket === socket;
    const mark = () => {
      if (current()) this.lastRx = this.clock.now();
    };
    socket.on("open", mark);
    socket.on("ping", mark);
    socket.on("pong", mark);
    socket.on("message", (data: unknown) => {
      if (!current()) return;
      mark();
      this.onFrame(socket, String(data));
    });
    socket.on("unexpected-response", (_request: unknown, response: unknown) => {
      if (!current()) return;
      const status = (response as { statusCode?: number } | undefined)?.statusCode;
      this.failure ??=
        status === 401
          ? "The Claude worker refused the token."
          : `The Claude worker answered HTTP ${status ?? "with an error"}.`;
      end(socket);
    });
    socket.on("error", (error: unknown) => {
      if (current()) this.failure ??= messageOf(error);
    });
    socket.on("close", () => {
      if (current()) this.lost();
    });
    this.armHeartbeat(socket);
    this.handshakeTimer = this.clock.schedule(() => {
      if (!current() || this.ready) return;
      this.failure ??= "The Claude worker did not greet back.";
      end(socket);
    }, this.timings.requestTimeoutMs);
  }

  private lost(): void {
    this.socket = undefined;
    this.ready = false;
    this.heartbeatTimer?.();
    this.handshakeTimer?.();
    for (const [id, pending] of this.pending) {
      if (pending.resend) continue;
      this.pending.delete(id);
      pending.cancelTimer();
      pending.settle(undefined);
    }
    this.retry(this.failure ?? "The connection to the Claude worker closed.");
  }

  private retry(detail: string): void {
    if (this.closed) return;
    this.setState(this.connectedOnce ? "reconnecting" : "connecting", detail);
    this.reconnectTimer?.();
    const delay = reconnectDelayMs(this.attempt, this.timings);
    this.attempt += 1;
    this.reconnectTimer = this.clock.schedule(() => void this.open(), delay);
  }

  private armHeartbeat(socket: WebSocketLike): void {
    this.heartbeatTimer?.();
    const tick = () => {
      if (this.socket !== socket) return;
      if (this.clock.now() - this.lastRx >= this.timings.silenceCloseMs) {
        this.failure ??= "The Claude worker went silent.";
        end(socket);
        return;
      }
      if (socket.readyState === OPEN) {
        socket.ping?.();
        socket.send(JSON.stringify({ type: "ping" }));
      }
      this.heartbeatTimer = this.clock.schedule(tick, this.timings.pingIntervalMs);
    };
    this.heartbeatTimer = this.clock.schedule(tick, this.timings.pingIntervalMs);
  }

  private setState(state: WorkerConnectionState, detail: string | undefined): void {
    if (this.stateNow === state && this.detailNow === detail) return;
    this.stateNow = state;
    this.detailNow = detail;
    this.options.onState?.(state, detail);
  }

  private welcomed(socket: WebSocketLike, bootId: string | undefined): void {
    const hello = this.options.hello;
    if (!hello) {
      this.connected(socket, bootId, undefined);
      return;
    }
    this.issue(hello, {
      resend: false,
      socket,
      settle: (reply) => {
        if (reply === undefined || this.socket !== socket) return;
        if (reply instanceof Error || !reply.ok) {
          this.failure ??=
            reply instanceof Error
              ? reply.message
              : (reply.error?.message ?? "The Claude worker refused the greeting.");
          end(socket);
          return;
        }
        this.connected(socket, bootId, reply.result);
      },
    });
  }

  private connected(socket: WebSocketLike, bootId: string | undefined, hello: unknown): void {
    this.handshakeTimer?.();
    this.ready = true;
    this.attempt = 0;
    this.connectedOnce = true;
    const rebooted = this.bootId !== undefined && bootId !== undefined && bootId !== this.bootId;
    if (bootId) this.bootId = bootId;
    if (rebooted) for (const cursor of this.cursors.values()) cursor.seq = 0;
    this.setState("connected", undefined);
    this.options.onConnected?.(rebooted, hello);
    if (this.socket !== socket || !this.ready) return;
    for (const sessionId of this.cursors.keys()) this.resume(sessionId);
    for (const pending of this.pending.values()) {
      if (!pending.resend || pending.sentOn === socket) continue;
      socket.send(pending.data);
      pending.sentOn = socket;
    }
    for (const data of this.queue.splice(0)) socket.send(data);
  }

  private onFrame(socket: WebSocketLike, raw: string): void {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    if (!value || typeof value !== "object") return;
    const frame = value as WorkerFrame;
    if (typeof frame.type !== "string") return;
    switch (frame.type) {
      case "welcome": {
        const welcome = welcomeFrameSchema.safeParse(frame);
        if (welcome.success && !this.ready) this.welcomed(socket, welcome.data.bootId);
        return;
      }
      case "ping":
        if (socket.readyState === OPEN) socket.send(JSON.stringify({ type: "pong" }));
        return;
      case "pong":
        return;
      case "reply": {
        const reply = replyFrameSchema.safeParse(frame);
        if (!reply.success) return;
        const pending = this.pending.get(reply.data.requestId);
        if (!pending) return;
        this.pending.delete(reply.data.requestId);
        pending.cancelTimer();
        pending.settle(reply.data);
        return;
      }
    }
    if (frame.type === this.options.sessions.event) {
      const { sessionId, seq } = frame;
      if (typeof sessionId === "string" && typeof seq === "number" && Number.isInteger(seq)) {
        this.onEvent(sessionId, seq, frame);
        return;
      }
    }
    this.options.onMessage(frame);
  }

  private cursor(): Cursor {
    return { seq: this.options.sessions.join === "start" ? 0 : undefined, resuming: false };
  }

  private onEvent(sessionId: string, seq: number, frame: WorkerFrame): void {
    let cursor = this.cursors.get(sessionId);
    if (!cursor) {
      cursor = this.cursor();
      this.cursors.set(sessionId, cursor);
    }
    if (cursor.seq === undefined) {
      if (cursor.resuming) return;
      cursor.seq = seq - 1;
    }
    if (seq <= cursor.seq) return;
    if (seq !== cursor.seq + 1) {
      this.resume(sessionId);
      return;
    }
    cursor.seq = seq;
    this.options.onMessage(frame);
  }

  private resume(sessionId: string): void {
    const cursor = this.cursors.get(sessionId);
    if (!cursor || cursor.resuming || !this.ready) return;
    cursor.resuming = true;
    const body = {
      type: this.options.sessions.resume,
      sessionId,
      afterSeq: cursor.seq ?? LIVE_EDGE,
    };
    this.issue(body, {
      resend: false,
      settle: (reply) => {
        cursor.resuming = false;
        if (reply === undefined) return;
        if (reply instanceof Error || !reply.ok) {
          this.options.onError?.(
            reply instanceof Error
              ? reply.message
              : (reply.error?.message ?? "The Claude worker refused a resume."),
          );
          return;
        }
        const result = reply.result as ResumeResult;
        if (!result.known) cursor.seq = 0;
        else if (cursor.seq === undefined) cursor.seq = result.lastSeq;
        else if (result.gap) cursor.seq = Math.max(cursor.seq, result.firstSeq - 1);
        this.options.onResume?.(sessionId, result);
      },
    });
  }

  private issue(
    body: { type: string },
    how: { resend: boolean; settle: Settle; timeoutMs?: number; socket?: WebSocketLike },
  ): void {
    this.counter += 1;
    const requestId = `r${this.counter}`;
    const entry: Pending = {
      data: JSON.stringify({ ...body, requestId }),
      resend: how.resend,
      sentOn: undefined,
      settle: how.settle,
      cancelTimer: () => undefined,
    };
    this.pending.set(requestId, entry);
    entry.cancelTimer = this.clock.schedule(() => {
      if (this.pending.get(requestId) !== entry) return;
      this.pending.delete(requestId);
      entry.settle(
        new Error(
          this.ready
            ? "The Claude worker did not answer in time."
            : `The Claude worker is not reachable${this.detailNow ? `: ${this.detailNow}` : "."}`,
        ),
      );
    }, how.timeoutMs ?? this.timings.requestTimeoutMs);
    const socket = how.socket ?? (this.ready ? this.socket : undefined);
    if (socket?.readyState === OPEN) {
      socket.send(entry.data);
      entry.sentOn = socket;
    }
  }
}
